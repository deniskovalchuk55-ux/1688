import { query, logRun } from '../db.js';
import { SEEDS, slugify } from '../taxonomy.js';
import * as gt from '../sources/googleTrends.js';
import * as yt from '../sources/youtube.js';
import {
  momentumScore, volumeScore, confidenceScore,
  totalScore, peakEstimate, horizonFor
} from '../scoring.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upsertTrend({ title, category, ageGroup, horizon }) {
  const slug = slugify(title);
  const [row] = await query(
    `INSERT INTO trends (slug, title, category, age_group, horizon)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO UPDATE
       SET last_seen = now(), horizon = EXCLUDED.horizon, status = 'active'
     RETURNING id`,
    [slug, title, category, ageGroup, horizon]
  );
  return row.id;
}

async function saveSignal(trendId, source, value, prev, growth, payload) {
  await query(
    `INSERT INTO trend_signals (trend_id, source, value, prev_value, growth_pct, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [trendId, source, value, prev ?? null, growth ?? null, payload ? JSON.stringify(payload) : null]
  );
}

async function saveScore(trendId, s) {
  await query(
    `INSERT INTO trend_scores (trend_id, momentum, volume, confidence, score, peak_estimate, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (trend_id) DO UPDATE SET
       momentum = EXCLUDED.momentum, volume = EXCLUDED.volume,
       confidence = EXCLUDED.confidence, score = EXCLUDED.score,
       peak_estimate = EXCLUDED.peak_estimate, updated_at = now()`,
    [trendId, s.momentum, s.volume, s.confidence, s.score, s.peakEstimate]
  );
}

async function saveMedia(trendId, videos) {
  if (!videos?.length) return;
  await query('DELETE FROM trend_media WHERE trend_id = $1 AND source = $2', [trendId, 'youtube']);
  for (const v of videos.slice(0, 4)) {
    await query(
      `INSERT INTO trend_media (trend_id, source, url, thumb_url, title, views, published_at)
       VALUES ($1, 'youtube', $2, $3, $4, $5, $6)`,
      [trendId, v.url, v.thumb, v.title, v.views, v.publishedAt]
    );
  }
}

// Обробка одного запиту: Google + YouTube -> оцінка -> база.
async function processKeyword({ q, category, age }) {
  let google = null;
  let youtube = null;

  try {
    google = await gt.interestOverTime(q);
  } catch (e) {
    console.warn(`[google] ${q}: ${e.message}`);
  }

  try {
    youtube = await yt.videoVelocity(q);
  } catch (e) {
    console.warn(`[youtube] ${q}: ${e.message}`);
  }

  if (!google && !youtube) return null;

  const growth = google?.growthPct ?? 0;
  const momentum = momentumScore({
    googleGrowthPct: growth,
    youtubeViewsPerDay: youtube?.viewsPerDay ?? 0
  });
  const volume = volumeScore({
    googleLatest: google?.latest ?? 0,
    youtubeTotalViews: youtube?.totalViews ?? 0
  });
  const confidence = confidenceScore({
    sources: [google, youtube],
    googleGrowthPct: growth
  });
  const score = totalScore({ momentum, volume, confidence });
  const horizon = horizonFor(growth, momentum);

  const trendId = await upsertTrend({
    title: q, category, ageGroup: age, horizon
  });

  if (google) {
    await saveSignal(trendId, 'google_trends', google.lastWeekAvg,
      google.prevWeekAvg, growth, { series: google.series });
  }
  if (youtube) {
    await saveSignal(trendId, 'youtube', youtube.viewsPerDay,
      null, null, { totalViews: youtube.totalViews });
    await saveMedia(trendId, youtube.videos);
  }

  await saveScore(trendId, {
    momentum, volume, confidence, score,
    peakEstimate: peakEstimate(momentum, growth)
  });

  return { q, score, growth: Math.round(growth) };
}

// Пошук нових тем, яких немає в посівному списку.
async function discoverNew(seed) {
  try {
    const rising = await gt.risingQueries(seed.q);
    return rising
      .filter((r) => r.breakout || r.growth >= 100)
      .map((r) => ({ q: r.query, category: seed.category, age: seed.age }));
  } catch {
    return [];
  }
}

export async function collectTrends({ discover = true } = {}) {
  const run = await logRun('collect', 'google+youtube');
  const done = [];
  let failed = 0;

  try {
    for (const seed of SEEDS) {
      const res = await processKeyword(seed).catch((e) => {
        failed++;
        console.warn(`[collect] ${seed.q}: ${e.message}`);
        return null;
      });
      if (res) done.push(res);
      await sleep(1200); // Google не любить частих звернень
    }

    if (discover) {
      const seen = new Set(SEEDS.map((s) => s.q));
      for (const seed of SEEDS.slice(0, 12)) {
        const found = await discoverNew(seed);
        for (const f of found) {
          if (seen.has(f.q)) continue;
          seen.add(f.q);
          const res = await processKeyword(f).catch(() => null);
          if (res) done.push({ ...res, isNew: true });
          await sleep(1200);
        }
        await sleep(800);
      }
    }

    await archiveStale();
    await run.finish(true, done.length,
      failed ? `${failed} запитів не вдалось` : null);

    console.log(`[collect] оброблено ${done.length}, помилок ${failed}`);
    return done;
  } catch (e) {
    await run.finish(false, done.length, e.message);
    throw e;
  }
}

// Тренди, які не оновлювались 5 днів і мають низьку оцінку, ховаємо зі списку.
// Дані лишаються — якщо тема повернеться, вона знову стане активною.
async function archiveStale() {
  await query(`
    UPDATE trends SET status = 'archived'
    WHERE status = 'active'
      AND last_seen < now() - interval '5 days'
      AND id IN (SELECT trend_id FROM trend_scores WHERE score < 25)
  `);
}
