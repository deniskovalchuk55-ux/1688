import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query, migrate } from './db.js';
import { collectTrends } from './collect.js';
import { sourceProducts } from './sourceProducts.js';
import { CATEGORIES, AGE_GROUPS, HORIZONS } from './taxonomy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/meta', (_req, res) => {
  res.json({ categories: CATEGORIES, ageGroups: AGE_GROUPS, horizons: HORIZONS });
});

app.get('/api/trends', async (req, res) => {
  try {
    const { category, age, horizon, limit = 25 } = req.query;
    const where = [`t.status = 'active'`];
    const params = [];

    if (category) { params.push(category); where.push(`t.category = $${params.length}`); }
    if (age) { params.push(age); where.push(`t.age_group = $${params.length}`); }
    if (horizon) { params.push(horizon); where.push(`t.horizon = $${params.length}`); }
    params.push(Math.min(Number(limit) || 25, 100));

    const rows = await query(`
      SELECT
        t.id, t.title, t.category, t.age_group, t.horizon, t.first_seen, t.last_seen,
        s.momentum, s.volume, s.confidence, s.score, s.peak_estimate, s.updated_at,
        (SELECT growth_pct FROM trend_signals
          WHERE trend_id = t.id AND source = 'google_trends'
          ORDER BY captured_at DESC LIMIT 1) AS growth_pct,
        (SELECT value FROM trend_signals
          WHERE trend_id = t.id AND source = 'youtube'
          ORDER BY captured_at DESC LIMIT 1) AS yt_views_per_day,
        (SELECT thumb_url FROM trend_media
          WHERE trend_id = t.id ORDER BY views DESC LIMIT 1) AS thumb,
        (SELECT COUNT(*)::int FROM products WHERE trend_id = t.id) AS product_count,
        (SELECT MAX((profit->'best'->>'profitUah')::numeric)
          FROM products WHERE trend_id = t.id) AS top_profit
      FROM trends t
      JOIN trend_scores s ON s.trend_id = t.id
      WHERE ${where.join(' AND ')}
      ORDER BY s.score DESC
      LIMIT $${params.length}
    `, params);

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/trends/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [trend] = await query(`
      SELECT t.*, s.momentum, s.volume, s.confidence, s.score, s.peak_estimate
      FROM trends t LEFT JOIN trend_scores s ON s.trend_id = t.id
      WHERE t.id = $1`, [id]);

    if (!trend) return res.status(404).json({ error: 'Тренд не знайдено' });

    const [signal] = await query(`
      SELECT payload, growth_pct FROM trend_signals
      WHERE trend_id = $1 AND source = 'google_trends'
      ORDER BY captured_at DESC LIMIT 1`, [id]);

    const media = await query(
      'SELECT * FROM trend_media WHERE trend_id = $1 ORDER BY views DESC', [id]);

    const products = await query(
      `SELECT * FROM products WHERE trend_id = $1
       ORDER BY (profit->'best'->>'profitUah')::numeric DESC NULLS LAST`, [id]);

    const [q] = await query(
      'SELECT query_cn, note FROM trend_queries WHERE trend_id = $1', [id]);

    res.json({
      ...trend,
      growth_pct: signal?.growth_pct ?? null,
      series: signal?.payload?.series ?? [],
      media,
      products,
      query_cn: q?.query_cn ?? null,
      query_note: q?.note ?? null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/status', async (_req, res) => {
  try {
    const runs = await query(
      'SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 20');
    const [counts] = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'archived') AS archived,
        COUNT(*) FILTER (WHERE first_seen > now() - interval '24 hours') AS added_today
      FROM trends`);

    res.json({
      counts,
      lastRun: runs[0] ?? null,
      runs,
      sources: {
        youtube: Boolean(process.env.YOUTUBE_API_KEY),
        prom: Boolean(process.env.PROM_API_TOKEN),
        claude: Boolean(process.env.ANTHROPIC_API_KEY)
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

let collecting = false;

async function runCollect(reason) {
  if (collecting) {
    console.log(`[${reason}] збір уже триває, пропускаю`);
    return;
  }
  collecting = true;
  try {
    await collectTrends();
    if (process.env.APIFY_TOKEN) {
      await sourceProducts().catch((e) =>
        console.warn('[1688] підбір не вдався:', e.message));
    }
  } catch (e) {
    console.error(`[${reason}]`, e.message);
  } finally {
    collecting = false;
  }
}

app.get('/api/debug', (_req, res) => {
  const dir = path.join(__dirname, 'dist');
  const out = { dist: false };
  try {
    out.dist = fs.existsSync(dir);
    if (out.dist) {
      out.files = fs.readdirSync(dir);
      const assets = path.join(dir, 'assets');
      if (fs.existsSync(assets)) out.assets = fs.readdirSync(assets);
      out.html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      out.hasBootMarker = out.html.includes('id="boot"');
    }
  } catch (e) {
    out.error = e.message;
  }
  res.type('text/plain').send(JSON.stringify(out, null, 2));
});

app.post('/api/collect', async (_req, res) => {
  res.json({ started: true });
  runCollect('manual');
});

let sourcing = false;

async function runSourcing(reason, trendIds) {
  if (sourcing) {
    console.log(`[${reason}] підбір товарів уже триває, пропускаю`);
    return;
  }
  sourcing = true;
  try {
    await sourceProducts({ trendIds });
  } catch (e) {
    console.error(`[${reason}]`, e.message);
  } finally {
    sourcing = false;
  }
}

app.post('/api/source', async (req, res) => {
  const ids = Array.isArray(req.body?.trendIds) ? req.body.trendIds : null;
  res.json({ started: true });
  runSourcing('manual', ids);
});

// Зібраний інтерфейс лежить у dist і віддається тим самим сервером.
const dist = path.join(__dirname, 'dist');
if (fs.existsSync(dist)) {
  console.log('[web] dist знайдено:', fs.readdirSync(dist).join(', '));
  // Файли в assets мають унікальні імена, їх кешувати безпечно.
  app.use(express.static(dist, { index: false, maxAge: '1y' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    // Саму сторінку не кешуємо, інакше браузер показує стару версію.
    res.set('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  console.error('[web] dist НЕ знайдено — інтерфейс не зібрався');
  console.error('[web] вміст каталогу:', fs.readdirSync(__dirname).join(', '));
  app.get('/', (_req, res) =>
    res.status(500).send('Інтерфейс не зібрався. Дані доступні через /api/trends'));
}

const PORT = process.env.PORT || 3000;

migrate()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () =>
      console.log(`[api] слухаю 0.0.0.0:${PORT}`));

    const schedule = process.env.COLLECT_CRON || '*/30 * * * *';
    cron.schedule(schedule, () => runCollect('cron'));
    console.log(`[cron] розклад: ${schedule}`);

    // Якщо база порожня — збираємо одразу, щоб не чекати перший крон.
    query('SELECT COUNT(*)::int AS n FROM trends')
      .then(([r]) => {
        if (r.n === 0) {
          console.log('[start] база порожня, збираю тренди');
          runCollect('start');
        }
      })
      .catch(() => {});
  })
  .catch((e) => {
    console.error('Не вдалось стартувати:', e.message);
    process.exit(1);
  });
