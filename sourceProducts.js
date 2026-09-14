import { query, logRun } from './db.js';
import { toChineseQuery } from './translate.js';
import { search1688 } from './sourcing.js';
import { cnyRate, compareDelivery, bestPlatform, weightFor } from './profit.js';
import { SETTINGS } from './settings.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Чи вартий продавець довіри. Дешевий товар у ненадійного
// продавця обертається поверненнями, тому фільтруємо рано.
function sellerOk(p) {
  const { minSellerRating, minSellerReviews } = SETTINGS.filters;
  if (p.sellerRating !== null && p.sellerRating < minSellerRating) return false;
  if (p.sellerReviews && p.sellerReviews < minSellerReviews) return false;
  return true;
}

async function saveQuery(trendId, q) {
  await query(
    `INSERT INTO trend_queries (trend_id, query_cn, note)
     VALUES ($1, $2, $3)
     ON CONFLICT (trend_id) DO UPDATE
       SET query_cn = EXCLUDED.query_cn, note = EXCLUDED.note`,
    [trendId, q.query, q.note || null]
  );
}

async function saveProduct(trendId, p, profit) {
  await query(
    `INSERT INTO products
       (trend_id, offer_id, title, url, image, images, price_cny, moq,
        weight_kg, sold, seller_name, seller_rating, seller_reviews,
        seller_years, profit, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
     ON CONFLICT (trend_id, offer_id) DO UPDATE SET
       price_cny = EXCLUDED.price_cny,
       sold = EXCLUDED.sold,
       seller_rating = EXCLUDED.seller_rating,
       seller_reviews = EXCLUDED.seller_reviews,
       profit = EXCLUDED.profit,
       fetched_at = now()`,
    [
      trendId, p.offerId, p.title, p.url, p.image,
      JSON.stringify(p.images || []), p.priceCny, p.moq,
      p.weightKg, p.sold, p.sellerName, p.sellerRating,
      p.sellerReviews, p.sellerYears, JSON.stringify(profit)
    ]
  );
}

// Підбирає товари під один тренд.
async function sourceOne(trend, rate) {
  const q = await toChineseQuery(trend.title, trend.category);
  await saveQuery(trend.id, q);

  const found = await search1688(q.query, { limit: 12 });
  const kept = [];

  for (const p of found) {
    if (!sellerOk(p)) continue;

    const weightKg = p.weightKg || weightFor(trend.category);
    const delivery = compareDelivery({
      priceCny: p.priceCny,
      weightKg,
      category: trend.category,
      platform: 'prom',
      rate,
      horizon: trend.horizon
    });

    const method = delivery.recommended;
    const platforms = bestPlatform({
      priceCny: p.priceCny,
      weightKg,
      category: trend.category,
      rate,
      method
    });

    if (platforms.best.profitUah < SETTINGS.filters.minProfitUah) continue;

    const profit = {
      weightKg,
      recommended: {
        platform: platforms.best.platform,
        method,
        reason: delivery.reason
      },
      best: platforms.best,
      platforms: platforms.all,
      delivery: { air: delivery.air, sea: delivery.sea }
    };

    kept.push({ p, profit });
    if (kept.length >= SETTINGS.filters.maxProducts) break;
  }

  // Найвигідніші зверху.
  kept.sort((a, b) => b.profit.best.profitUah - a.profit.best.profitUah);

  for (const { p, profit } of kept) {
    await saveProduct(trend.id, p, profit);
  }

  return kept.length;
}

export async function sourceProducts({ trendIds = null } = {}) {
  const run = await logRun('sourcing', '1688');
  let total = 0;
  let failed = 0;

  try {
    const rate = await cnyRate();
    console.log(`[1688] курс юаня: ${rate} грн`);

    const trends = trendIds?.length
      ? await query(
          `SELECT t.id, t.title, t.category, t.horizon
           FROM trends t WHERE t.id = ANY($1)`,
          [trendIds]
        )
      : await query(
          `SELECT t.id, t.title, t.category, t.horizon
           FROM trends t
           JOIN trend_scores s ON s.trend_id = t.id
           WHERE t.status = 'active'
           ORDER BY s.score DESC
           LIMIT $1`,
          [SETTINGS.sourcingTopN]
        );

    for (const trend of trends) {
      try {
        const n = await sourceOne(trend, rate);
        total += n;
        console.log(`[1688] ${trend.title}: ${n} товарів`);
      } catch (e) {
        failed++;
        console.warn(`[1688] ${trend.title}: ${e.message}`);
      }
      await sleep(1500);
    }

    await run.finish(true, total, failed ? `${failed} тем без товарів` : null);
    return total;
  } catch (e) {
    await run.finish(false, total, e.message);
    throw e;
  }
}
