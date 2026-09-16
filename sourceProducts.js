import { query, logRun } from './db.js';
import { toChineseQuery } from './translate.js';
import { search1688 } from './sourcing.js';
import { marketSnapshot } from './competition.js';
import { cnyRate, compareDelivery, bestPlatform, weightFor } from './profit.js';
import { SETTINGS } from './settings.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Скільки днів дані про товар вважаються свіжими.
// Ціни на 1688 не міняються щогодини, тому частіше немає сенсу.
const REFRESH_DAYS = Number(process.env.SOURCING_REFRESH_DAYS || 3);

// Чи вартий продавець довіри. Кожен показник може бути відсутній —
// тоді його просто не враховуємо.
function sellerOk(p) {
  const f = SETTINGS.filters;
  if (p.sold !== null && p.sold < f.minSold) return false;
  if (p.sellerYears !== null && p.sellerYears < f.minSellerYears) return false;
  if (p.returnRate !== null && p.returnRate < f.minReturnRate) return false;
  return true;
}

async function saveMarket(groupId, m) {
  await query(
    `INSERT INTO trend_market
       (group_id, market_avg, sellers, level, easiest, platforms,
        demand, bestsellers, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (group_id) DO UPDATE SET
       market_avg = EXCLUDED.market_avg,
       sellers = EXCLUDED.sellers,
       level = EXCLUDED.level,
       easiest = EXCLUDED.easiest,
       platforms = EXCLUDED.platforms,
       demand = EXCLUDED.demand,
       bestsellers = EXCLUDED.bestsellers,
       checked_at = now()`,
    [groupId, m.marketAvg, m.sellers, m.level, m.easiest,
     JSON.stringify(m.platforms), m.demand || 0,
     JSON.stringify(m.bestsellers || [])]
  );
}

async function saveQuery(groupId, q) {
  await query(
    `INSERT INTO trend_queries (group_id, query_cn, note)
     VALUES ($1, $2, $3)
     ON CONFLICT (group_id) DO UPDATE
       SET query_cn = EXCLUDED.query_cn, note = EXCLUDED.note`,
    [groupId, q.query, q.note || null]
  );
}

async function saveProduct(groupId, p, profit) {
  await query(
    `INSERT INTO products
       (group_id, offer_id, title, url, image, images, price_cny, moq,
        weight_kg, sold, seller_name, seller_rating, seller_reviews,
        seller_years, profit, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
     ON CONFLICT (group_id, offer_id) DO UPDATE SET
       price_cny = EXCLUDED.price_cny,
       sold = EXCLUDED.sold,
       seller_rating = EXCLUDED.seller_rating,
       seller_years = EXCLUDED.seller_years,
       profit = EXCLUDED.profit,
       fetched_at = now()`,
    [
      groupId, p.offerId, p.title, p.url, p.image,
      JSON.stringify({ images: p.images, tiers: p.priceTiers, shopUrl: p.shopUrl }),
      p.priceCny, p.moq, p.weightKg, p.sold, p.sellerName,
      p.returnRate, p.sold, p.sellerYears, JSON.stringify(profit)
    ]
  );
}

// Ціни конкурентів. Не залежать від 1688, тому збираються окремо.
export async function refreshMarket(groups) {
  for (const g of groups) {
    try {
      const m = await marketSnapshot(g.name);
      if (m) {
        await saveMarket(g.id, m);
        console.log(
          `[ринок] ${g.name}: медіана ${m.marketAvg} грн, ` +
          `${m.sellers} пропозицій, ${m.demand} відгуків (${m.sources.join(', ')}), ` +
          `конкуренція ${m.level}`
        );
      }
    } catch (e) {
      console.warn(`[ринок] ${g.name}: ${e.message}`);
    }
    await sleep(800);
  }
}

// Один запит до 1688 на одну групу товарів.
async function sourceOne(group, rate, market) {
  const q = await toChineseQuery(group.name, group.category);
  await saveQuery(group.id, q);

  const found = await search1688(q.query, { limit: 12 });
  const kept = [];

  for (const p of found) {
    if (!sellerOk(p)) continue;

    const weightKg = p.weightKg || weightFor(group.category);
    const delivery = compareDelivery({
      priceCny: p.priceCny,
      weightKg,
      category: group.category,
      platform: 'prom',
      rate,
      horizon: group.horizon || 'near'
    });

    const method = delivery.recommended;
    const platforms = bestPlatform({
      priceCny: p.priceCny,
      weightKg,
      category: group.category,
      rate,
      method,
      marketAvgUah: market?.market_avg ?? null
    });

    if (platforms.best.profitUah < SETTINGS.filters.minProfitUah) continue;

    kept.push({
      p,
      profit: {
        weightKg,
        recommended: {
          platform: platforms.best.platform,
          method,
          reason: delivery.reason
        },
        best: platforms.best,
        platforms: platforms.all,
        marketAvg: market?.market_avg ?? null,
        delivery: { air: delivery.air, sea: delivery.sea }
      }
    });

    if (kept.length >= SETTINGS.filters.maxProducts) break;
  }

  kept.sort((a, b) => b.profit.best.profitUah - a.profit.best.profitUah);

  for (const { p, profit } of kept) {
    await saveProduct(group.id, p, profit);
  }

  return kept.length;
}

// Групи, яким потрібен підбір: ті, де товарів ще немає,
// або де дані застаріли. Нові обслуговуються першими.
async function groupsNeedingProducts(limit) {
  return query(
    `SELECT g.id, g.name, g.category
     FROM trend_groups g
     JOIN trend_group_scores s ON s.group_id = g.id
     LEFT JOIN (
       SELECT group_id, MAX(fetched_at) AS last FROM products GROUP BY group_id
     ) p ON p.group_id = g.id
     WHERE g.broad = false
       AND (p.last IS NULL OR p.last < now() - ($2 || ' days')::interval)
     ORDER BY (p.last IS NULL) DESC, s.score DESC
     LIMIT $1`,
    [limit, String(REFRESH_DAYS)]
  );
}

export async function sourceProducts({ groupIds = null, limit = null } = {}) {
  const run = await logRun('sourcing', '1688');
  let total = 0;
  let failed = 0;

  try {
    const rate = await cnyRate();
    console.log(`[1688] курс юаня: ${rate} грн`);

    const groups = groupIds?.length
      ? await query(
          'SELECT id, name, category FROM trend_groups WHERE id = ANY($1)',
          [groupIds]
        )
      : await groupsNeedingProducts(limit || SETTINGS.sourcingTopN);

    if (!groups.length) {
      console.log('[1688] усі групи свіжі, підбір не потрібен');
      await run.finish(true, 0, 'нічого оновлювати');
      return 0;
    }

    for (const group of groups) {
      try {
        const [market] = await query(
          'SELECT market_avg FROM trend_market WHERE group_id = $1', [group.id]);

        const n = await sourceOne(group, rate, market);
        total += n;
        console.log(`[1688] ${group.name}: ${n} товарів`);
      } catch (e) {
        failed++;
        console.warn(`[1688] ${group.name}: ${e.message}`);
      }
      await sleep(1500);
    }

    await run.finish(true, total, failed ? `${failed} груп без товарів` : null);
    return total;
  } catch (e) {
    await run.finish(false, total, e.message);
    throw e;
  }
}
