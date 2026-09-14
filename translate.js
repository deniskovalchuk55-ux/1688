const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Кеш перекладів: тема не змінює назву, перекладати щоразу немає сенсу.
const cache = new Map();

// Перетворює український запит на пошуковий запит для 1688.
// Просто транслітерація не годиться: на 1688 шукають торговими
// термінами, а не побутовими назвами.
export async function toChineseQuery(title, category) {
  if (!KEY) throw new Error('ANTHROPIC_API_KEY не заданий');
  if (cache.has(title)) return cache.get(title);

  const prompt = `Ти допомагаєш шукати товари на китайському оптовому майданчику 1688.

Український запит: "${title}"
Категорія: ${category}

Переклади це у пошуковий запит китайською так, як його набрав би закупівельник на 1688.
Правила:
- використовуй торгові терміни, які реально вживають продавці
- 2–5 ієрогліфічних слів, не речення
- якщо запит надто загальний (наприклад назва бренду), уточни до конкретного типу товару
- не додавай пояснень

Відповідай ТІЛЬКИ JSON без розмітки:
{"query":"...","note":"що саме шукаємо, українською, коротко"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
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

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude повернув не JSON');

  const parsed = JSON.parse(match[0]);
  cache.set(title, parsed);
  return parsed;
}
