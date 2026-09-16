import { query } from './db.js';

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

async function askClaude(prompt, maxTokens = 2000) {
  if (!KEY) throw new Error('ANTHROPIC_API_KEY не заданий');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error('Claude повернув не JSON');
  return JSON.parse(match[0]);
}

// Зводимо різні формулювання в один товар.
// «жіноча куртка зимова», «куртка жіноча на зиму», «тепла куртка жіноча»
// це один товар, а не три різні теми.
export async function clusterQueries(items) {
  const list = items
    .map((t) => `${t.id}. ${t.title} [${t.category}, ${t.age_group}]`)
    .join('\n');

  const prompt = `Ось пошукові запити українською, які люди вводять у Google, шукаючи товари:

${list}

Згрупуй їх за товаром, який людина насправді шукає.
Різні формулювання одного товару — одна група.
Різні товари — різні групи, навіть якщо слова схожі.

Правила:
- назва групи має бути тим, що закуповують: конкретний товар, а не категорія чи бренд
- якщо запит надто загальний («пума», «одяг»), не тягни його в групу конкретного товару — зроби окрему групу з поміткою broad: true
- один запит належить рівно одній групі
- не вигадуй запитів, яких немає в списку

Відповідай ТІЛЬКИ JSON без розмітки:
{"groups":[{"name":"тепла жіноча зимова куртка","category":"clothing_w","age":"18-23","broad":false,"ids":[6,14,22]}]}`;

  const parsed = await askClaude(prompt, 3000);
  return parsed.groups || [];
}

async function saveGroup(g) {
  const [row] = await query(
    `INSERT INTO trend_groups (name, category, age_group, broad)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE
       SET category = EXCLUDED.category,
           age_group = EXCLUDED.age_group,
           broad = EXCLUDED.broad,
           updated_at = now()
     RETURNING id`,
    [g.name, g.category || null, g.age || null, Boolean(g.broad)]
  );
  return row.id;
}

// Оцінка групи — це не сума її частин.
// Беремо найсильніший сигнал, а обсяг попиту складаємо:
// людина шукає одним формулюванням, але покупців рахуємо всіх.
async function rescoreGroup(groupId) {
  await query(
    `INSERT INTO trend_group_scores
       (group_id, momentum, volume, confidence, score, members, updated_at)
     SELECT
       $1,
       MAX(s.momentum),
       LEAST(SUM(s.volume), 100),
       MAX(s.confidence),
       ROUND(MAX(s.momentum) * 0.5 + LEAST(SUM(s.volume), 100) * 0.3
             + MAX(s.confidence) * 0.2),
       COUNT(*),
       now()
     FROM trends t
     JOIN trend_scores s ON s.trend_id = t.id
     WHERE t.group_id = $1 AND t.status = 'active'
     ON CONFLICT (group_id) DO UPDATE SET
       momentum = EXCLUDED.momentum,
       volume = EXCLUDED.volume,
       confidence = EXCLUDED.confidence,
       score = EXCLUDED.score,
       members = EXCLUDED.members,
       updated_at = now()`,
    [groupId]
  );
}

export async function groupTrends() {
  const items = await query(
    `SELECT t.id, t.title, t.category, t.age_group
     FROM trends t
     JOIN trend_scores s ON s.trend_id = t.id
     WHERE t.status = 'active'
     ORDER BY s.score DESC
     LIMIT 120`
  );

  if (!items.length) return 0;

  const groups = await clusterQueries(items);
  let assigned = 0;

  for (const g of groups) {
    if (!g.name || !Array.isArray(g.ids) || !g.ids.length) continue;

    const groupId = await saveGroup(g);
    await query('UPDATE trends SET group_id = $1 WHERE id = ANY($2)', [groupId, g.ids]);
    await rescoreGroup(groupId);
    assigned += g.ids.length;
  }

  console.log(`[групування] ${groups.length} товарів із ${items.length} запитів`);
  return groups.length;
}
