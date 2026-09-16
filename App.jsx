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

function Filters({ meta, value, onChange }) {
  const groups = [
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
    fetch(`${API}/api/groups/${id}`)
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
        <h2>{data.name}</h2>

        <div className="metrics">
          <div className="metric">
            <div className="metric-label">Оцінка</div>
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
          <div className="metric">
            <div className="metric-label">Формулювань</div>
            <div className="metric-value">{data.members?.length ?? 0}</div>
          </div>
        </div>

        {data.members?.length > 0 && (
          <>
            <div className="section-head">Як його шукають</div>
            <div className="members">
              {data.members.map((m) => (
                <div className="member" key={m.id}>
                  <span>{m.title}</span>
                  <span className={`growth ${growthClass(m.growth_pct)}`}>
                    {fmtGrowth(m.growth_pct)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

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
                {data.market.sellers} пропозицій · найвільніше на{' '}
                {PLATFORM_NAME[data.market.easiest] || data.market.easiest}
                {data.market.demand > 0 &&
                  ` · ${data.market.demand} відгуків у покупців`}
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

              {data.market.bestsellers?.length > 0 && (
                <>
                  <p className="market-sub bestsellers-head">
                    Найбільше беруть саме це
                  </p>
                  <div className="bestsellers">
                    {data.market.bestsellers.map((b, i) => (
                      <a className="bestseller" key={i} href={b.url}
                        target="_blank" rel="noreferrer">
                        {b.image && <img src={b.image} alt="" loading="lazy" />}
                        <div>
                          <div className="bestseller-title">{b.title}</div>
                          <div className="bestseller-sub">
                            {fmtUah(b.price)} · {b.reviews} відгуків ·{' '}
                            {PLATFORM_NAME[b.platform] || b.platform}
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </>
              )}
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
                        <span className="product-profit">{fmtUah(best.profitUah)}</span>
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
          <span>Запитів у роботі</span>
          <span>{counts?.active ?? 0}</span>
        </div>
        <div className="run">
          <span>Додано за добу</span>
          <span>{counts?.added_today ?? 0}</span>
        </div>
        {(runs || []).slice(0, 5).map((r) => (
          <div className={`run ${r.ok === false ? 'run-fail' : ''}`} key={r.id}>
            <span>
              {r.job === 'sourcing' ? '1688' : 'збір'} ·{' '}
              {new Date(r.started_at).toLocaleString('uk-UA')}
            </span>
            <span>
              {r.finished_at
                ? r.ok ? `${r.items}` : (r.message || 'помилка')
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
  const [filters, setFilters] = useState({ category: null, age: null });
  const [groups, setGroups] = useState(null);
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
    setGroups(null);
    fetch(`${API}/api/groups?${qs}`)
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setGroups(d) : setErr(d.error)))
      .catch((e) => setErr(e.message));
  }, [filters]);

  const collect = async () => {
    setBusy(true);
    await fetch(`${API}/api/collect`, { method: 'POST' }).catch(() => {});
    setTimeout(() => setBusy(false), 3000);
  };

  const regroup = async () => {
    setBusy(true);
    await fetch(`${API}/api/group`, { method: 'POST' }).catch(() => {});
    setTimeout(() => setBusy(false), 3000);
  };

  const refreshPrices = async () => {
    setBusy(true);
    await fetch(`${API}/api/market`, { method: 'POST' }).catch(() => {});
    setTimeout(() => setBusy(false), 3000);
  };

  if (selected) {
    return (
      <div className="wrap">
        <Detail id={selected} onBack={() => setSelected(null)} />
      </div>
    );
  }

  const lead = groups?.[0];
  const rest = groups?.slice(1) ?? [];
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
      {groups === null && !err && <p className="empty">Завантажую…</p>}

      {groups?.length === 0 && (
        <div className="empty">
          <p>Товарів ще немає. Запити збираються, але не згруповані.</p>
          <button onClick={regroup} disabled={busy}>
            {busy ? 'Групую…' : 'Згрупувати в товари'}
          </button>
        </div>
      )}

      {lead && (
        <>
          <button className="lead" onClick={() => setSelected(lead.id)}>
            <div className="lead-label">Найсильніший сигнал зараз</div>
            <h2>{lead.name}</h2>
            <div className="lead-figure">
              <span className={`lead-growth growth ${growthClass(lead.growth_pct)}`}>
                {fmtGrowth(lead.growth_pct)}
              </span>
              <span className="lead-note">
                {lead.top_profit > 0
                  ? `до ${fmtUah(lead.top_profit)} з одиниці`
                  : `${lead.members} формулювань`}
              </span>
            </div>
          </button>

          <div className="board">
            {rest.map((g, i) => (
              <button className="row" key={g.id} onClick={() => setSelected(g.id)}>
                <span className="rank">{i + 2}</span>
                <span>
                  <span className="row-title">{g.name}</span>
                  <span className="row-meta">
                    {g.top_profit > 0 && `до ${fmtUah(g.top_profit)} · `}
                    {g.competition
                      ? `конкуренція ${g.competition}`
                      : `${g.members} формулювань`}
                  </span>
                </span>
                <span className="row-right">
                  <span className={`growth ${growthClass(g.growth_pct)}`}>
                    {fmtGrowth(g.growth_pct)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {groups?.length > 0 && (
        <div className="actions">
          <button onClick={refreshPrices} disabled={busy}>
            {busy ? 'Збираю ціни…' : 'Оновити ціни конкурентів'}
          </button>
        </div>
      )}

      <Status status={status} />
    </div>
  );
}
