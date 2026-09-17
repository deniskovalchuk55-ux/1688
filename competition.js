// Ціни конкурентів на українських майданчиках.
// У кожного джерела два способи: спершу внутрішній API сайту,
// потім читання сторінки. Якщо перший блокують, спрацює другий.

function stats(prices) {
  const clean = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (!clean.length) return null;

  // Відкидаємо крайні 10% з кожного боку: на маркетплейсах
  // завжди трапляються аксесуари за 50 грн і опт за 50 тисяч.
  const cut = Math.floor(clean.length * 0.1);
  const core = clean.length > 6 ? clean.slice(cut, clean.length - cut) : clean;

  return {
    count: clean.length,
    min: Math.round(core[0]),
    max: Math.round(core[core.length - 1]),
    median: Math.round(core[Math.floor(core.length / 2)]),
    avg: Math.round(core.reduce((s, p) => s + p, 0) / core.length)
  };
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache'
};

async function getText(url, extra = {}) {
  const res = await fetch(url, { headers: { ...HEADERS, ...extra } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

// Ціни зі сторінки: маркетплейси вкладають їх у розмітку
// у кількох різних виглядах, тому пробуємо всі.
function pricesFromHtml(html) {
  const found = [];

  // JSON усередині сторінки
  for (const m of html.matchAll(/"price"\s*:\s*"?(\d{2,7})(?:\.\d+)?"?/g)) {
    found.push(Number(m[1]));
  }
  // Розмітка товару за стандартом schema.org
  for (const m of html.matchAll(/itemprop="price"[^>]*content="(\d{2,7})/g)) {
    found.push(Number(m[1]));
  }
  // Атрибути карток
  for (const m of html.matchAll(/data-qaprice="(\d{2,7})"/g)) {
    found.push(Number(m[1]));
  }
  // Текст із гривнями
  if (found.length < 5) {
    for (const m of html.matchAll(/(\d[\d\s]{1,6})\s*(?:грн|₴)/g)) {
      const n = Number(m[1].replace(/\s/g, ''));
      if (n >= 30) found.push(n);
    }
  }

  return found;
}

function countReviews(html) {
  let total = 0;
  for (const m of html.matchAll(/"comments_amount"\s*:\s*(\d+)/g)) total += Number(m[1]);
  if (total) return total;
  for (const m of html.matchAll(/(\d+)\s*(?:відгук|отзыв)/gi)) total += Number(m[1]);
  return total;
}

// --- Rozetka ---

export async function rozetkaPrices(term) {
  // Спершу внутрішній API, яким користується їхній сайт.
  try {
    const url =
      'https://search.rozetka.com.ua/ua/search/api/v6/?front-type=xl' +
      `&country=UA&lang=ua&text=${encodeURIComponent(term)}&page=1`;
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) {
      const data = await res.json();
      const goods = data?.data?.goods || [];
      const s = stats(goods.map((g) => Number(g.price)));
      if (s) {
        const reviewsTotal = goods.reduce(
          (a, g) => a + (Number(g.comments_amount) || 0), 0);
        const bestsellers = [...goods]
          .filter((g) => Number(g.comments_amount) > 0)
          .sort((a, b) => Number(b.comments_amount) - Number(a.comments_amount))
          .slice(0, 3)
          .map((g) => ({
            title: g.title,
            price: Number(g.price),
            reviews: Number(g.comments_amount),
            url: g.href,
            image: g.image_main || g.image
          }));
        return {
          platform: 'rozetka',
          ...s,
          total: data?.data?.total ?? goods.length,
          reviewsTotal,
          bestsellers
        };
      }
    }
  } catch {
    // тихо переходимо до читання сторінки
  }

  // Запасний спосіб: звичайна сторінка пошуку.
  const html = await getText(
    `https://rozetka.com.ua/ua/search/?text=${encodeURIComponent(term)}`);
  const s = stats(pricesFromHtml(html));
  if (!s) throw new Error('цін не знайдено');

  const totalMatch = html.match(/"total"\s*:\s*(\d+)/);
  return {
    platform: 'rozetka',
    ...s,
    total: totalMatch ? Number(totalMatch[1]) : s.count,
    reviewsTotal: countReviews(html),
    bestsellers: []
  };
}

// --- OLX ---

export async function olxPrices(term) {
  // Внутрішній API часто віддає 403 без браузерних заголовків.
  try {
    const url =
      'https://www.olx.ua/api/v1/offers/?offset=0&limit=40' +
      `&query=${encodeURIComponent(term)}`;
    const res = await fetch(url, {
      headers: { ...HEADERS, 'Accept': 'application/json', 'Origin': 'https://www.olx.ua' }
    });
    if (res.ok) {
      const data = await res.json();
      const items = data?.data || [];
      const prices = items
        .map((i) => Number((i.params || []).find((x) => x.key === 'price')?.value?.value))
        .filter(Boolean);
      const s = stats(prices);
      if (s) {
        return {
          platform: 'olx',
          ...s,
          total: data?.metadata?.total_elements ?? items.length,
          reviewsTotal: 0,
          bestsellers: []
        };
      }
    }
  } catch {
    // тихо переходимо до читання сторінки
  }

  const html = await getText(
    `https://www.olx.ua/uk/list/q-${encodeURIComponent(term).replace(/%20/g, '-')}/`);
  const s = stats(pricesFromHtml(html));
  if (!s) throw new Error('цін не знайдено');

  const totalMatch = html.match(/(\d[\d\s]{1,6})\s*оголошен/i);
  return {
    platform: 'olx',
    ...s,
    total: totalMatch ? Number(totalMatch[1].replace(/\s/g, '')) : s.count,
    reviewsTotal: 0,
    bestsellers: []
  };
}

// --- Prom ---

export async function promPrices(term) {
  const html = await getText(
    `https://prom.ua/search?search_term=${encodeURIComponent(term)}`);

  const s = stats(pricesFromHtml(html));
  if (!s) throw new Error('цін не знайдено');

  const totalMatch = html.match(/(\d[\d\s]{2,})\s*(?:товар|пропозиц)/i);
  return {
    platform: 'prom',
    ...s,
    total: totalMatch ? Number(totalMatch[1].replace(/\s/g, '')) : s.count,
    reviewsTotal: countReviews(html),
    bestsellers: []
  };
}

// Зводимо все разом і оцінюємо, наскільки щільний ринок.
export async function marketSnapshot(term) {
  const sources = [
    ['prom', promPrices],
    ['rozetka', rozetkaPrices],
    ['olx', olxPrices]
  ];

  const results = await Promise.allSettled(sources.map(([, fn]) => fn(term)));

  const platforms = [];
  const failed = [];

  results.forEach((r, i) => {
    const name = sources[i][0];
    if (r.status === 'fulfilled' && r.value) {
      platforms.push(r.value);
    } else {
      const why = r.status === 'rejected' ? r.reason?.message : 'порожня відповідь';
      failed.push(`${name}: ${why}`);
    }
  });

  if (failed.length) console.warn(`[ринок] ${term} — не вийшло: ${failed.join(', ')}`);
  if (!platforms.length) return null;

  const medians = platforms.map((p) => p.median);
  const marketAvg = Math.round(medians.reduce((s, m) => s + m, 0) / medians.length);

  // Найбільша цифра серед майданчиків показує щільність краще,
  // ніж сума: у частини джерел total — це лише розмір вибірки.
  const sellers = Math.max(...platforms.map((p) => p.total || p.count || 0));

  let level = 'низька';
  if (sellers > 500) level = 'висока';
  else if (sellers > 100) level = 'середня';

  const demand = platforms.reduce((sum, p) => sum + (p.reviewsTotal || 0), 0);

  const bestsellers = platforms
    .flatMap((p) => (p.bestsellers || []).map((b) => ({ ...b, platform: p.platform })))
    .sort((a, b) => b.reviews - a.reviews)
    .slice(0, 4);

  const easiest = [...platforms].sort(
    (a, b) => (a.total || a.count || 0) - (b.total || b.count || 0)
  )[0];

  return {
    marketAvg,
    sellers,
    level,
    demand,
    bestsellers,
    easiest: easiest.platform,
    platforms,
    sources: platforms.map((p) => p.platform),
    failed,
    checkedAt: new Date().toISOString()
  };
}
