import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL не заданий. Додай його у .env');
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

export async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db] схему застосовано');
}

export async function logRun(job, source) {
  const [row] = await query(
    'INSERT INTO job_runs (job, source) VALUES ($1, $2) RETURNING id',
    [job, source]
  );
  return {
    id: row.id,
    async finish(ok, items, message) {
      await query(
        'UPDATE job_runs SET finished_at = now(), ok = $2, items = $3, message = $4 WHERE id = $1',
        [row.id, ok, items ?? 0, message ? String(message).slice(0, 500) : null]
      );
    }
  };
}
