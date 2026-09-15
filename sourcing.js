const TOKEN = process.env.APIFY_TOKEN;
// Актор можна замінити через змінну, якщо цей не влаштує за ціною.
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

// 1688 підсвічує збіг із запитом тегами прямо в назві.
function cleanTitle(t) {
  return String(t || '').replace(/<[^>]+>/g, '').trim();
}

// Цінові сходинки виду [{q:"10~149个", p:6.2}].
// Беремо ціну за одиницю при заданій кількості.
function priceAtQty(tiers, qty) {
  if (!Array.isArray(tiers) || !tiers.length) return null;
  let best = null;
  for (const t of tiers) {
    const price = toNumber(pick(t, 'p', 'price', 'value'));
    const from = toNumber(String(pick(t, 'q', 'quantity') || '').split(/[~\-≥]/)[0]);
    if (price === null) continue;
    if (from === null || from <= qty) best = price;
  }
  return best;
}

// Мінімальне замовлення з першої цінової сходинки.
function moqFromTiers(tiers) {
  if (!Array.isArray(tiers) || !tiers.length) return 1;
  const first = toNumber(String(pick(tiers[0], 'q', 'quantity') || '').split(/[~\-≥]/)[0]);
  return first && first > 0 ? first : 1;
}

// Зводимо відповідь актора до єдиної форми.
function normalize(raw) {
  const tiers = pick(raw, 'price_tiers', 'priceTiers', 'quantityPrices') || [];

  const price =
    toNumber(pick(raw, 'price', 'minPrice', 'priceInfo.price')) ??
    priceAtQty(tiers, 1);

  const offerId = String(pick(raw, 'id', 'offerId', 'productId') || '');

  const images = []
    .concat(pick(raw, 'images', 'imageList') || [])
    .map((i) => (typeof i === 'string' ? i : pick(i, 'url', 'imageUrl')))
    .filter(Boolean);

  const mainImage = pick(raw, 'image', 'imageUrl', 'offerPicUrl') || images[0] || null;

  return {
    offerId,
    title: cleanTitle(pick(raw, 'title', 'subject', 'name')),
    url: pick(raw, 'url', 'detailUrl') ||
      (offerId ? `https://detail.1688.com/offer/${offerId}.html` : null),
    shopUrl: pick(raw, 'shop_url', 'shopUrl', 'winPortUrl'),
    priceCny: price,
    priceTiers: tiers.map((t) => ({
      from: toNumber(String(pick(t, 'q', 'quantity') || '').split(/[~\-≥]/)[0]) || 1,
      price: toNumber(pick(t, 'p', 'price', 'value'))
    })).filter((t) => t.price),
    moq: moqFromTiers(tiers),
    weightKg: toNumber(pick(raw, 'weight', 'unitWeight')),
    // Скільки разів товар купили — головний сигнал попиту.
    sold: toNumber(pick(raw, 'sales', 'sold', 'saleCount')) || 0,
    // Частка покупців, які повернулись. У 1688 це найближче до оцінки якості.
    returnRate: toNumber(pick(raw, 'return_rate', 'returnRate')),
    sellerName: pick(raw, 'seller', 'sellerName', 'shop.text', 'loginId'),
    sellerType: pick(raw, 'seller_type', 'bizType'),
    sellerYears: toNumber(pick(raw, 'seller_years', 'sellerYears', 'shop.tpYear')),
    location: pick(raw, 'location', 'province'),
    isFactory: Boolean(pick(raw, 'is_factory', 'isFactory')),
    isVerified: Boolean(pick(raw, 'is_verified', 'isVerified')),
    image: mainImage,
    images: images.slice(0, 5)
  };
}

// Пошук за китайським запитом.
export async function search1688(query, { limit = 12 } = {}) {
  if (!TOKEN) throw new Error('APIFY_TOKEN не заданий');

  const url =
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items` +
    `?token=${TOKEN}&timeout=180`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyword: query,
      maxPages: 1,
      // Сортуємо за продажами за рік: те, що вже купують,
      // надійніше за те, що просто дешеве.
      sortType: 'va_sales360',
      descendOrder: true,
      searchType: 'pcmarket'
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify ${res.status}: ${body.slice(0, 300)}`);
  }

  const items = await res.json();
  if (!Array.isArray(items)) return [];

  return items
    .map(normalize)
    .filter((p) => p.offerId && p.priceCny > 0)
    .slice(0, limit);
}

// Ціна за одиницю при закупівлі партією — для калькулятора опту.
export function unitPriceFor(product, qty) {
  if (!product.priceTiers?.length) return product.priceCny;
  let price = product.priceCny;
  for (const t of product.priceTiers) {
    if (t.from <= qty) price = t.price;
  }
  return price;
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
