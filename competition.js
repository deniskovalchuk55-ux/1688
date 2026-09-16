// Ціни конкурентів на українських майданчиках.
// Кожне джерело окремо: якщо одне відвалиться, решта працює.

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

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept-Language': 'uk-UA,uk;q=0.9'
};

// Rozetka віддає результати пошуку у вигляді JSON для власного фронтенду.
export async function rozetkaPrices(term) {
  const url =
    'https://search.rozetka.com.ua/ua/search/api/v6/?front-type=xl' +
    `&country=UA&lang=ua&text=${encodeURIComponent(term)}&page=1`;

  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Rozetka ${res.status}`);

  const data = await res.json();
  const goods = data?.data?.goods || [];
  const prices = goods.map((g) => Number(g.price)).filter(Boolean);

  const s = stats(prices);
  if (!s) return null;

  // Точних продажів Rozetka не віддає. Кількість відгуків —
  // найближчий публічний показник: більше відгуків, більше покупок.
  const reviews = goods.map((g) => Number(g.comments_amount) || 0);
  const reviewsTotal = reviews.reduce((a, b) => a + b, 0);

  // Найпопулярніші позиції за відгуками — саме те, що люди беруть.
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
    bestsellers,
    samples: goods.slice(0, 3).map((g) => ({
      title: g.title,
      price: Number(g.price),
      url: g.href,
      image: g.image_main || g.image
    }))
  };
}

// OLX має відкритий endpoint, яким користується їхній сайт.
export async function olxPrices(term) {
  const url =
    'https://www.olx.ua/api/v1/offers/?offset=0&limit=40' +
    `&query=${encodeURIComponent(term)}`;

  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`OLX ${res.status}`);

  const data = await res.json();
  const items = data?.data || [];

  const prices = items
    .map((i) => {
      const p = (i.params || []).find((x) => x.key === 'price');
      return Number(p?.value?.value);
    })
    .filter(Boolean);

  const s = stats(prices);
  if (!s) return null;

  return {
    platform: 'olx',
    ...s,
    total: data?.metadata?.total_elements ?? items.length,
    samples: items.slice(0, 3).map((i) => ({
      title: i.title,
      price: Number((i.params || []).find((x) => x.key === 'price')?.value?.value),
      url: i.url,
      image: i.photos?.[0]?.link?.replace('{width}x{height}', '400x300')
    }))
  };
}

// У Prom немає відкритого пошукового API, тому читаємо сторінку
// й дістаємо ціни з розмітки. Найкрихкіше з трьох джерел.
export async function promPrices(term) {
  const url = `https://prom.ua/search?search_term=${encodeURIComponent(term)}`;

  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Prom ${res.status}`);

  const html = await res.text();
  const prices = [];

  // Варіант перший: ціни у вбудованому JSON.
  for (const m of html.matchAll(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/g)) {
    prices.push(Number(m[1]));
  }

  // Варіант другий: розмітка карток товару.
  if (prices.length < 3) {
    for (const m of html.matchAll(/data-qaid="product_price"[^>]*data-qaprice="(\d+)"/g)) {
      prices.push(Number(m[1]));
    }
  }

  const s = stats(prices);
  if (!s) return null;

  const totalMatch = html.match(/(\d[\d\s]{2,})\s*(?:товар|пропозиц)/i);

  // Відгуки як непрямий показник попиту.
  let reviewsTotal = 0;
  for (const m of html.matchAll(/(\d+)\s*відгук/gi)) {
    reviewsTotal += Number(m[1]);
  }

  return {
    platform: 'prom',
    ...s,
    total: totalMatch ? Number(totalMatch[1].replace(/\s/g, '')) : s.count,
    reviewsTotal,
    bestsellers: [],
    samples: []
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

  // Де найменше тісно — туди й вигідніше заходити.
  const easiest = [...platforms].sort(
    (a, b) => (a.total || a.count || 0) - (b.total || b.count || 0)
  )[0];

  // Скільки відгуків зібрали товари цієї теми разом.
  // Прямих продажів майданчики не показують, тому це найкраще,
  // що можна дізнатись ззовні.
  const demand = platforms.reduce((sum, p) => sum + (p.reviewsTotal || 0), 0);

  const bestsellers = platforms
    .flatMap((p) => (p.bestsellers || []).map((b) => ({ ...b, platform: p.platform })))
    .sort((a, b) => b.reviews - a.reviews)
    .slice(0, 4);

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
