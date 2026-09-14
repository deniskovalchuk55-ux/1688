const KEY = process.env.YOUTUBE_API_KEY;
const BASE = 'https://www.googleapis.com/youtube/v3';

async function call(endpoint, params) {
  if (!KEY) throw new Error('YOUTUBE_API_KEY не заданий');
  const url = new URL(`${BASE}/${endpoint}`);
  Object.entries({ ...params, key: KEY }).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Свіжі відео за запитом + їхня швидкість набору переглядів.
// Швидкість важливіша за абсолютні перегляди: відео з 80k за добу
// говорить більше, ніж старе відео з мільйоном.
export async function videoVelocity(keyword, { days = 21, max = 10 } = {}) {
  const publishedAfter = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const search = await call('search', {
    part: 'snippet',
    q: keyword,
    type: 'video',
    order: 'viewCount',
    regionCode: process.env.TRENDS_GEO || 'UA',
    relevanceLanguage: 'uk',
    maxResults: max,
    publishedAfter
  });

  const ids = (search.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) {
    return { totalViews: 0, viewsPerDay: 0, videos: [] };
  }

  const details = await call('videos', {
    part: 'statistics,snippet',
    id: ids.join(',')
  });

  const now = Date.now();
  const videos = (details.items || []).map((v) => {
    const published = new Date(v.snippet.publishedAt).getTime();
    const ageDays = Math.max((now - published) / 86400000, 0.5);
    const views = Number(v.statistics?.viewCount || 0);
    return {
      id: v.id,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      thumb: v.snippet.thumbnails?.medium?.url || null,
      publishedAt: v.snippet.publishedAt,
      views,
      viewsPerDay: Math.round(views / ageDays)
    };
  });

  const totalViews = videos.reduce((s, v) => s + v.views, 0);
  const viewsPerDay = videos.reduce((s, v) => s + v.viewsPerDay, 0);

  return {
    totalViews,
    viewsPerDay,
    videos: videos.sort((a, b) => b.viewsPerDay - a.viewsPerDay)
  };
}
