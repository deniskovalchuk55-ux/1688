import { query, logRun } from './db.js';
import { toChineseQuery, translateTitles } from './translate.js';
import { search1688 } from './sourcing.js';
import { marketSnapshot } from './competition.js';
import { cnyRate, compareDelivery, bestPlatform, weightFor } from './profit.js';
import { SETTINGS } from './settings.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Чи вартий продавець довіри. Дешевий товар у ненадійного
// продавця обертається поверненнями, тому фільтруємо рано.
// Кожен показник може бути відсутній — тоді його просто не враховуємо.
function sellerOk(p) {
  const f = SETTINGS.filters;
  if (p.sold !== null && p.sold < f.minSold) return false;
  if (p.sellerYears !== null && p.sellerYears < f.minSellerYears) return false;
  if (p.returnRate !== null && p.returnRate < f.minReturnRate) return false;
  return true;
}

async function saveMarket(trendId, m) {
  await query(
    `INSERT INTO trend_market
       (trend_id, market_avg, sellers, level, easiest, platforms, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (trend_id) DO UPDATE SET
       market_avg = EXCLUDED.market_avg,
       sellers = EXCLUDED.sellers,
       level = EXCLUDED.level,
       easiest = EXCLUDED.easiest,
       platforms = EXCLUDED.platforms,
       checked_at = now()`,
    [trendId, m.marketAvg, m.sellers, m.level, m.easiest, JSON.stringify(m.platforms)]
  );
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

async function saveProduct(trendId, p, profit, titleUk) {
  await query(
    `INSERT INTO products
       (trend_id, offer_id, title, title_uk, url, image, images, price_cny, moq,
        weight_kg, sold, seller_name, seller_rating, seller_reviews,
        seller_years, profit, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
     ON CONFLICT (trend_id, offer_id) DO UPDATE SET
       title_uk = COALESCE(EXCLUDED.title_uk, products.title_uk),
       price_cny = EXCLUDED.price_cny,
       sold = EXCLUDED.sold,
       seller_rating = EXCLUDED.seller_rating,
       seller_reviews = EXCLUDED.seller_reviews,
       profit = EXCLUDED.profit,
       fetched_at = now()`,
    [
      trendId, p.offerId, p.title, titleUk, p.url, p.image,
      JSON.stringify({ images: p.images, tiers: p.priceTiers, shopUrl: p.shopUrl }),
      p.priceCny, p.moq, p.weightKg, p.sold, p.sellerName,
      p.returnRate, p.sold, p.sellerYears, JSON.stringify(profit)
    ]
  );
}

// Підбирає товари під один тренд.
async function sourceOne(trend, rate) {
  // Спершу дивимось, почім це вже продають в Україні.
  // Без цього рекомендована ціна була б вигаданою.
  let market = null;
  try {
    market = await marketSnapshot(trend.title);
    if (market) {
      await saveMarket(trend.id, market);
      console.log(
        `[ринок] ${trend.title}: медіана ${market.marketAvg} грн, ` +
        `${market.sellers} пропозицій, конкуренція ${market.level}`
      );
    }
  } catch (e) {
    console.warn(`[ринок] ${trend.title}: ${e.message}`);
  }

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
      method,
      marketAvgUah: market?.marketAvg ?? null
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
      marketAvg: market?.marketAvg ?? null,
      delivery: { air: delivery.air, sea: delivery.sea }
    };

    kept.push({ p, profit });
    if (kept.length >= SETTINGS.filters.maxProducts) break;
  }

  // Найвигідніші зверху.
  kept.sort((a, b) => b.profit.best.profitUah - a.profit.best.profitUah);

  // Перекладаємо назви одним запитом на всі товари теми — так дешевше.
  let titlesUk = kept.map(({ p }) => p.title);
  if (kept.length) {
    try {
      titlesUk = await translateTitles(kept.map(({ p }) => p.title));
    } catch (e) {
      console.warn('[переклад назв]', e.message);
    }
  }

  for (let i = 0; i < kept.length; i++) {
    const { p, profit } = kept[i];
    await saveProduct(trend.id, p, profit, titlesUk[i] || null);
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
