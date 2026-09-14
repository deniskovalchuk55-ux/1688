import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { query, migrate } from './db.js';
import { collectTrends } from './jobs/collect.js';
import { CATEGORIES, AGE_GROUPS, HORIZONS } from './taxonomy.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/meta', (_req, res) => {
  res.json({ categories: CATEGORIES, ageGroups: AGE_GROUPS, horizons: HORIZONS });
});

// Список трендів з фільтрами. Саме це бачиш на головній.
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
          WHERE trend_id = t.id ORDER BY views DESC LIMIT 1) AS thumb
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

// Деталі одного тренду: динаміка, відео, сигнали.
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

    res.json({
      ...trend,
      growth_pct: signal?.growth_pct ?? null,
      series: signal?.payload?.series ?? [],
      media
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Що система робила останнім часом і чи все живе.
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
        google_trends: Boolean(process.env.DATABASE_URL),
        youtube: Boolean(process.env.YOUTUBE_API_KEY),
        prom: Boolean(process.env.PROM_API_TOKEN),
        claude: Boolean(process.env.ANTHROPIC_API_KEY)
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Ручний запуск збору — кнопка «Оновити зараз».
app.post('/api/collect', async (_req, res) => {
  res.json({ started: true });
  collectTrends().catch((e) => console.error('[collect]', e.message));
});

const PORT = process.env.PORT || 3000;

migrate()
  .then(() => {
    app.listen(PORT, () => console.log(`[api] http://localhost:${PORT}`));

    const schedule = process.env.COLLECT_CRON || '*/30 * * * *';
    cron.schedule(schedule, () => {
      console.log('[cron] запускаю збір');
      collectTrends().catch((e) => console.error('[cron]', e.message));
    });
    console.log(`[cron] розклад: ${schedule}`);
  })
  .catch((e) => {
    console.error('Не вдалось стартувати:', e.message);
    process.exit(1);
  });
