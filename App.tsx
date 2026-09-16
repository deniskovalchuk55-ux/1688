import React, { useEffect, useState } from 'react';

const API = '';

const fmtGrowth = (g) => {
  if (g === null || g === undefined) return '—';
  const n = Math.round(Number(g));
  return `${n > 0 ? '+' : ''}${n}%`;
};

const growthClass = (g) => {
  const n = Number(g) || 0;
  if (n >= 100) return 'hot';
  if (n >= 10) return 'up';
  return 'flat';
};

const fmtUah = (n) => `${Math.round(Number(n) || 0).toLocaleString('uk-UA')} грн`;

const PLATFORM_NAME = { prom: 'Prom', rozetka: 'Rozetka', olx: 'OLX' };

const LEVEL_CLASS = { 'низька': 'lvl-low', 'середня': 'lvl-mid', 'висока': 'lvl-high' };

const fmtViews = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)} млн`;
  if (v >= 1000) return `${Math.round(v / 1000)} тис`;
  return String(v);
};

function Sparkline({ series, color }) {
  if (!series?.length) return null;
  const vals = series.map((p) => p.v);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals);
  const w = 54, h = 20;
  const step = w / Math.max(vals.length - 1, 1);
  const d = vals
    .map((v, i) => {
      const y = h - ((v - min) / Math.max(max - min, 1)) * h;
      return `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Filters({ meta, value, onChange }) {
  const groups = [
    { key: 'horizon', items: meta.horizons, allLabel: 'Усі горизонти' },
    { key: 'category', items: meta.categories, allLabel: 'Усі категорії' },
    { key: 'age', items: meta.ageGroups, allLabel: 'Будь-який вік' }
  ];

  return (
    <div className="filters">
      {groups.map((g) => (
        <div className="filter-row" key={g.key}>
          <button className="chip" aria-pressed={!value[g.key]}
            onClick={() => onChange({ ...value, [g.key]: null })}>
            {g.allLabel}
          </button>
          {(g.items || []).map((it) => (
            <button key={it.id} className="chip"
              aria-pressed={value[g.key] === it.id}
              onClick={() => onChange({ ...value, [g.key]: it.id })}>
              {it.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function Detail({ id, onBack }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/trends/${id}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <p className="err">{err}</p>;
  if (!data) return <p className="empty">Завантажую…</p>;

  return (
    <>
      <button className="back" onClick={onBack}>← до списку</button>
      <div className="detail">
        <h2>{data.title}</h2>
        <p className="lead-note">{data.peak_estimate}</p>

        <div className="metrics">
          <div className="metric">
            <div className="metric-label">Зростання за тиждень</div>
            <div className={`metric-value growth ${growthClass(data.growth_pct)}`}>
              {fmtGrowth(data.growth_pct)}
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">Загальна оцінка</div>
            <div className="metric-value">{Math.round(data.score ?? 0)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Швидкість</div>
            <div className="metric-value">{Math.round(data.momentum ?? 0)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Обсяг попиту</div>
            <div className="metric-value">{Math.round(data.volume ?? 0)}</div>
          </div>
        </div>

        {data.market && (
          <>
            <div className="section-head">Почім це вже продають в Україні</div>
            <div className="market">
              <div className="market-top">
                <span className="market-avg">{fmtUah(data.market.market_avg)}</span>
                <span className={`market-level ${LEVEL_CLASS[data.market.level] || ''}`}>
                  конкуренція {data.market.level}
                </span>
              </div>
              <p className="market-sub">
                {data.market.sellers} пропозицій разом · найвільніше на{' '}
                {PLATFORM_NAME[data.market.easiest] || data.market.easiest}
              </p>

              <table className="product-table">
                <tbody>
                  {(data.market.platforms || []).map((pl) => (
                    <tr key={pl.platform}>
                      <td>{PLATFORM_NAME[pl.platform] || pl.platform}</td>
                      <td>
                        {fmtUah(pl.median)}
                        <span className="market-range">
                          {' '}({fmtUah(pl.min)}–{fmtUah(pl.max)})
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {data.query_cn && (
          <p className="query-note">
            Шукали на 1688 як <span className="cn">{data.query_cn}</span>
            {data.query_note ? ` — ${data.query_note}` : ''}
          </p>
        )}

        {data.products?.length > 0 && (
          <>
            <div className="section-head">Що можна взяти на 1688</div>
            <div className="products">
              {data.products.map((p) => {
                const pr = p.profit || {};
                const best = pr.best || {};
                const rec = pr.recommended || {};
                return (
                  <div className="product" key={p.id}>
                    {p.image && (
                      <img className="product-img" src={p.image} alt="" loading="lazy" />
                    )}
                    <div className="product-body">
                      <a className="product-title" href={p.url || '#'}
                        target="_blank" rel="noreferrer">
                        {p.title || 'Без назви'}
                      </a>

                      <div className="product-figures">
                        <span className="product-profit">
                          {fmtUah(best.profitUah)}
                        </span>
                        <span className="product-sub">
                          прибуток з одиниці на {PLATFORM_NAME[best.platform] || best.platform}
                        </span>
                      </div>

                      <table className="product-table">
                        <tbody>
                          <tr>
                            <td>Ціна на 1688</td>
                            <td>{Number(p.price_cny).toFixed(2)} ¥</td>
                          </tr>
                          <tr>
                            <td>Собівартість тут</td>
                            <td>{fmtUah(best.costUah)}</td>
                          </tr>
                          <tr>
                            <td>Ціна продажу</td>
                            <td>{fmtUah(best.priceUah)}</td>
                          </tr>
                          <tr>
                            <td>Доставка</td>
                            <td>
                              {rec.method === 'sea' ? 'морем' : 'авіа'}, {best.deliveryDays} дн
                            </td>
                          </tr>
                          <tr>
                            <td>Мінімум замовлення</td>
                            <td>{p.moq} шт</td>
                          </tr>
                          <tr>
                            <td>Вже продано</td>
                            <td>{p.sold ? `${p.sold} шт` : '—'}</td>
                          </tr>
                          <tr>
                            <td>Продавець</td>
                            <td>
                              {p.seller_years ? `${p.seller_years} р. на 1688` : '—'}
                              {p.seller_rating ? ` · повторних ${p.seller_rating}%` : ''}
                            </td>
                          </tr>
                        </tbody>
                      </table>

                      {rec.reason && <p className="product-why">{rec.reason}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {data.media?.length > 0 && (
          <>
            <div className="section-head">Що знімають про це на YouTube</div>
            <div className="videos">
              {data.media.map((m) => (
                <a className="video" key={m.id} href={m.url}
                  target="_blank" rel="noreferrer">
                  {m.thumb_url && <img src={m.thumb_url} alt="" loading="lazy" />}
                  <div>
                    <div className="video-title">{m.title}</div>
                    <div className="video-views">{fmtViews(m.views)} переглядів</div>
                  </div>
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Status({ status }) {
  if (!status) return null;
  const { counts, runs } = status;

  return (
    <>
      <div className="section-head">Як працює збір</div>
      <div className="runs">
        <div className="run">
          <span>Трендів у роботі</span>
          <span>{counts?.active ?? 0}</span>
        </div>
        <div className="run">
          <span>Додано за добу</span>
          <span>{counts?.added_today ?? 0}</span>
        </div>
        {(runs || []).slice(0, 5).map((r) => (
          <div className={`run ${r.ok === false ? 'run-fail' : ''}`} key={r.id}>
            <span>{new Date(r.started_at).toLocaleString('uk-UA')}</span>
            <span>
              {r.finished_at
                ? r.ok ? `${r.items} тем` : (r.message || 'помилка')
                : 'триває…'}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function App() {
  const [meta, setMeta] = useState({ categories: [], ageGroups: [], horizons: [] });
  const [filters, setFilters] = useState({ category: null, age: null, horizon: null });
  const [trends, setTrends] = useState(null);
  const [status, setStatus] = useState(null);
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/meta`).then((r) => r.json()).then(setMeta).catch(() => {});
    fetch(`${API}/api/status`).then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && qs.set(k, v));
    setTrends(null);
    fetch(`${API}/api/trends?${qs}`)
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setTrends(d) : setErr(d.error)))
      .catch((e) => setErr(e.message));
  }, [filters]);

  const collect = async () => {
    setBusy(true);
    await fetch(`${API}/api/collect`, { method: 'POST' }).catch(() => {});
    setTimeout(() => setBusy(false), 3000);
  };

  if (selected) {
    return (
      <div className="wrap">
        <Detail id={selected} onBack={() => setSelected(null)} />
      </div>
    );
  }

  const lead = trends?.[0];
  const rest = trends?.slice(1) ?? [];
  const updated = status?.lastRun?.started_at
    ? new Date(status.lastRun.started_at).toLocaleTimeString('uk-UA', {
        hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="wrap">
      <header className="masthead">
        <h1>Радар трендів</h1>
        {updated && <span className="stamp">оновлено о {updated}</span>}
      </header>

      <Filters meta={meta} value={filters} onChange={setFilters} />

      {err && <p className="err">{err}</p>}

      {trends === null && !err && <p className="empty">Завантажую…</p>}

      {trends?.length === 0 && (
        <div className="empty">
          <p>Тут поки порожньо. Запусти перший збір — він триває кілька хвилин.</p>
          <button onClick={collect} disabled={busy}>
            {busy ? 'Збираю…' : 'Зібрати тренди'}
          </button>
        </div>
      )}

      {lead && (
        <>
          <div className="lead">
            <div className="lead-label">Найсильніший сигнал зараз</div>
            <h2>{lead.title}</h2>
            <div className="lead-figure">
              <span className={`lead-growth growth ${growthClass(lead.growth_pct)}`}>
                {fmtGrowth(lead.growth_pct)}
              </span>
              <span className="lead-note">{lead.peak_estimate}</span>
            </div>
          </div>

          <div className="board">
            {rest.map((t, i) => (
              <button className="row" key={t.id} onClick={() => setSelected(t.id)}>
                <span className="rank">{i + 2}</span>
                <span>
                  <span className="row-title">{t.title}</span>
                  <span className="row-meta">
                    {t.top_profit > 0
                      ? `до ${fmtUah(t.top_profit)} з одиниці${
                          t.competition ? ` · конкуренція ${t.competition}` : ''
                        }`
                      : t.peak_estimate}
                  </span>
                </span>
                <span className="row-right">
                  <span className={`growth ${growthClass(t.growth_pct)}`}>
                    {fmtGrowth(t.growth_pct)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <Status status={status} />
    </div>
  );
}
