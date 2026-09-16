import { query, logRun } from './db.js';
import { relatedAll } from './googleTrends.js';
import { slugify } from './taxonomy.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Скільки конкретних запитів витягувати з однієї широкої теми.
const PER_BROAD = Number(process.env.EXPAND_PER_BROAD || 8);

// Запит вважається конкретним, якщо в ньому є уточнення,
// а не лише назва бренду чи категорії.
function looksConcrete(text, broadName) {
  const q = text.toLowerCase().trim();
  const broad = broadName.toLowerCase().trim();

  if (q === broad) return false;
  // Одне слово — це майже завжди бренд або категорія.
  if (q.split(/\s+/).length < 2) return false;
  // Відсіюємо навігаційні й довідкові запити.
  if (/(купити|ціна|україн|київ|відгук|сайт|магазин|офіційн|розмір|таблиц)/.test(q)) {
    return false;
  }
  return true;
}

async function addTrend({ title, category, ageGroup }) {
  const slug = slugify(title);
  const [row] = await query(
    `INSERT INTO trends (slug, title, category, age_group, horizon, status)
     VALUES ($1, $2, $3, $4, 'near', 'active')
     ON CONFLICT (slug) DO UPDATE SET last_seen = now(), status = 'active'
     RETURNING id, (xmax = 0) AS is_new`,
    [slug, title, category, ageGroup]
  );
  return row;
}

// Бере широкі теми і витягує з них конкретні речі,
// які люди шукають усередині цієї теми.
export async function expandBroad() {
  const run = await logRun('expand', 'google');
  let added = 0;
  let checked = 0;

  try {
    const broad = await query(
      `SELECT g.id, g.name, g.category, g.age_group
       FROM trend_groups g
       LEFT JOIN trend_group_scores s ON s.group_id = g.id
       WHERE g.broad = true
       ORDER BY COALESCE(s.score, 0) DESC
       LIMIT 10`
    );

    if (!broad.length) {
      await run.finish(true, 0, 'широких тем немає');
      return 0;
    }

    for (const g of broad) {
      checked++;
      try {
        const related = await relatedAll(g.name);
        const concrete = related
          .filter((r) => looksConcrete(r.query, g.name))
          .slice(0, PER_BROAD);

        for (const r of concrete) {
          const row = await addTrend({
            title: r.query,
            category: g.category,
            ageGroup: g.age_group
          });
          if (row.is_new) added++;
        }

        console.log(
          `[розкриття] ${g.name}: ${concrete.length} конкретних запитів ` +
          `з ${related.length} суміжних`
        );
      } catch (e) {
        console.warn(`[розкриття] ${g.name}: ${e.message}`);
      }
      await sleep(1500);
    }

    await run.finish(true, added, `перевірено ${checked} широких тем`);
    return added;
  } catch (e) {
    await run.finish(false, added, e.message);
    throw e;
  }
}
