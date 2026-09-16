import googleTrends from 'google-trends-api';

const GEO = process.env.TRENDS_GEO || 'UA';

function parseJSON(raw) {
  // Бібліотека інколи повертає HTML замість JSON, коли Google тимчасово блокує.
  const trimmed = String(raw).trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    throw new Error('Google повернув не-JSON (ймовірно тимчасове обмеження)');
  }
  return JSON.parse(trimmed);
}

// Динаміка запиту за останні 90 днів.
// Повертає { latest, prevWeekAvg, lastWeekAvg, growthPct, series }
export async function interestOverTime(keyword) {
  const raw = await googleTrends.interestOverTime({
    keyword,
    geo: GEO,
    startTime: new Date(Date.now() - 90 * 24 * 3600 * 1000),
    granularTimeResolution: false
  });

  const data = parseJSON(raw);
  const points = (data?.default?.timelineData || []).map((p) => ({
    t: Number(p.time) * 1000,
    v: Number(p.value?.[0] ?? 0)
  }));

  if (points.length < 4) {
    return { latest: 0, lastWeekAvg: 0, prevWeekAvg: 0, growthPct: 0, series: points };
  }

  const tail = points.slice(-8);
  const lastWeek = tail.slice(-4);
  const prevWeek = tail.slice(0, 4);
  const avg = (arr) => arr.reduce((s, p) => s + p.v, 0) / (arr.length || 1);

  const lastWeekAvg = avg(lastWeek);
  const prevWeekAvg = avg(prevWeek);
  const growthPct = prevWeekAvg > 0
    ? ((lastWeekAvg - prevWeekAvg) / prevWeekAvg) * 100
    : (lastWeekAvg > 0 ? 100 : 0);

  return {
    latest: points.at(-1).v,
    lastWeekAvg,
    prevWeekAvg,
    growthPct,
    series: points.slice(-26)
  };
}

// Суміжні запити, що зростають. Саме тут ловляться нові товари,
// про які ми ще не знаємо і яких немає в посівному списку.
export async function risingQueries(keyword) {
  const raw = await googleTrends.relatedQueries({
    keyword,
    geo: GEO,
    startTime: new Date(Date.now() - 30 * 24 * 3600 * 1000)
  });

  const data = parseJSON(raw);
  const blocks = data?.default?.rankedList || [];
  const rising = blocks.at(-1)?.rankedKeyword || [];

  return rising
    .filter((r) => r.value >= 50)
    .slice(0, 8)
    .map((r) => ({
      query: r.query,
      growth: r.value,
      breakout: r.formattedValue === 'Breakout'
    }));
}

// Усі суміжні запити: і ті, що ростуть, і ті, що просто популярні.
// Саме тут широка тема на кшталт «пума» розкривається на конкретні речі.
export async function relatedAll(keyword) {
  const raw = await googleTrends.relatedQueries({
    keyword,
    geo: GEO,
    startTime: new Date(Date.now() - 90 * 24 * 3600 * 1000)
  });

  const data = parseJSON(raw);
  const blocks = data?.default?.rankedList || [];

  const top = (blocks[0]?.rankedKeyword || []).map((r) => ({
    query: r.query,
    weight: r.value,
    kind: 'top'
  }));

  const rising = (blocks.at(-1)?.rankedKeyword || []).map((r) => ({
    query: r.query,
    weight: r.value,
    kind: 'rising',
    breakout: r.formattedValue === 'Breakout'
  }));

  // Топові запити показують, що шукають найчастіше;
  // зростаючі — що почали шукати нещодавно. Потрібні обидва.
  const seen = new Set();
  return [...rising, ...top].filter((q) => {
    const k = q.query.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Що гуглять в Україні прямо зараз.
export async function dailyTrending() {
  const raw = await googleTrends.dailyTrends({ geo: GEO, trendDate: new Date() });
  const data = parseJSON(raw);
  const days = data?.default?.trendingSearchesDays || [];

  return days.flatMap((d) =>
    (d.trendingSearches || []).map((t) => ({
      query: t.title?.query,
      traffic: t.formattedTraffic,
      articles: (t.articles || []).slice(0, 2).map((a) => a.title)
    }))
  ).filter((t) => t.query);
}
