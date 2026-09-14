const TOKEN = process.env.APIFY_TOKEN;
// Актор можна замінити через змінну, якщо цей перестане працювати.
const ACTOR = process.env.APIFY_ACTOR || 'songd~1688-search-scraper';

// Різні актори називають поля по-різному. Забираємо перше, що знайшлось,
// щоб заміна актора не ламала решту системи.
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, part) => (o == null ? o : o[part]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Зводимо відповідь актора до єдиної форми.
function normalize(raw) {
  const price =
    toNumber(pick(raw, 'price', 'priceInfo.price', 'minPrice', 'wholesalePrice')) ??
    toNumber(pick(raw, 'priceRange.min', 'prices.0.price'));

  const images = []
    .concat(pick(raw, 'images', 'imageList', 'pictures') || [])
    .map((i) => (typeof i === 'string' ? i : pick(i, 'url', 'imageUrl', 'fullPathImageURI')))
    .filter(Boolean);

  const mainImage = pick(raw, 'image', 'imageUrl', 'mainImage', 'picUrl') || images[0] || null;

  return {
    offerId: String(pick(raw, 'offerId', 'id', 'productId') || ''),
    title: pick(raw, 'title', 'subject', 'name') || '',
    url: pick(raw, 'url', 'detailUrl', 'productUrl') || null,
    priceCny: price,
    moq: toNumber(pick(raw, 'moq', 'minOrderQuantity', 'beginAmount')) || 1,
    weightKg: toNumber(pick(raw, 'weight', 'unitWeight')),
    sold: toNumber(pick(raw, 'sold', 'saleCount', 'tradeCount', 'monthSold')) || 0,
    sellerName: pick(raw, 'sellerName', 'companyName', 'supplier.name', 'shopName'),
    sellerRating: toNumber(pick(raw, 'sellerRating', 'compositeServiceScore', 'supplier.rating')),
    sellerReviews: toNumber(pick(raw, 'sellerReviews', 'reviewCount', 'supplier.reviews')) || 0,
    sellerYears: toNumber(pick(raw, 'tpYear', 'supplier.years')) || null,
    image: mainImage,
    images: images.slice(0, 5)
  };
}

// Пошук за китайським запитом. Повертає нормалізовані товари.
export async function search1688(query, { limit = 10 } = {}) {
  if (!TOKEN) throw new Error('APIFY_TOKEN не заданий');

  const url =
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items` +
    `?token=${TOKEN}&timeout=120`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyword: query,
      keywords: [query],
      searchTerms: [query],
      maxItems: limit,
      maxResults: limit,
      country: 'ua'
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify ${res.status}: ${body.slice(0, 200)}`);
  }

  const items = await res.json();
  if (!Array.isArray(items)) return [];

  return items
    .map(normalize)
    .filter((p) => p.offerId && p.priceCny > 0);
}

// Витягує ідентифікатор товару з будь-якого посилання 1688,
// включно з короткими, які дає застосунок.
export async function resolveOfferId(link) {
  const direct = String(link).match(/offer\/(\d+)/) || String(link).match(/offerId=(\d+)/);
  if (direct) return direct[1];

  const res = await fetch(link, { redirect: 'follow' });
  const html = await res.text();
  const found = html.match(/offerId=(\d+)/) || html.match(/offer\?id=(\d+)/);
  return found ? found[1] : null;
}
