import { SETTINGS, commissionFor, weightFor } from './settings.js';

let cachedRate = null;
let cachedAt = 0;

// Курс юаня з Нацбанку. Кешуємо на добу — частіше не змінюється.
export async function cnyRate() {
  if (cachedRate && Date.now() - cachedAt < 86400000) return cachedRate;

  try {
    const res = await fetch(
      'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=CNY&json'
    );
    const [row] = await res.json();
    if (row?.rate) {
      cachedRate = Number(row.rate);
      cachedAt = Date.now();
      return cachedRate;
    }
  } catch (e) {
    console.warn('[курс] не вдалось отримати з НБУ:', e.message);
  }

  return SETTINGS.cnyToUahFallback;
}

// Вартість доставки одиниці товару обраним способом.
export function deliveryCost(weightKg, method) {
  const t = SETTINGS.delivery[method];
  if (!t) return 0;
  return Math.max(Math.round(weightKg * t.perKg), t.minCharge);
}

// Скільки коштує товар «на складі в Україні», у гривнях за штуку.
export function landedCost({ priceCny, weightKg, method, rate, qty = 1 }) {
  const goods = priceCny * rate;
  const inland = SETTINGS.chinaInlandCny * rate;
  // На великих партіях внутрішня доставка розкладається вигідніше.
  const inlandPerUnit = qty >= 10 ? inland * 0.6 : qty >= 5 ? inland * 0.8 : inland;
  return goods + inlandPerUnit + deliveryCost(weightKg, method);
}

// Рекомендована ціна продажу: витрати плюс націнка, з оглядом
// на ринок, якщо він відомий.
function suggestPrice(cost, marketAvg) {
  const base = cost * 2.4;
  if (!marketAvg || marketAvg <= 0) return Math.round(base / 10) * 10;
  // Тримаємось трохи нижче середньої по ринку, але не в збиток.
  const undercut = marketAvg * 0.9;
  return Math.round(Math.max(undercut, cost * 1.6) / 10) * 10;
}

// Повний розрахунок по одному товару для однієї платформи.
export function calcProfit({
  priceCny, weightKg, category, platform,
  method = 'air', rate, qty = 1, marketAvgUah = null
}) {
  const cost = landedCost({ priceCny, weightKg, method, rate, qty });
  const price = suggestPrice(cost, marketAvgUah);
  const commissionPct = commissionFor(platform, category);
  const commission = price * (commissionPct / 100);
  const profit = price - cost - commission;

  return {
    platform,
    method,
    qty,
    costUah: Math.round(cost),
    priceUah: Math.round(price),
    commissionPct,
    commissionUah: Math.round(commission),
    profitUah: Math.round(profit),
    marginPct: cost > 0 ? Math.round((profit / cost) * 100) : 0,
    deliveryDays: SETTINGS.delivery[method].days
  };
}

// Порівнюємо авіа і море для конкретного товару й горизонту тренду.
// Якщо тренд коротко живе, море не встигне — відсікаємо.
export function compareDelivery({ priceCny, weightKg, category, platform, rate, horizon }) {
  const air = calcProfit({ priceCny, weightKg, category, platform, method: 'air', rate });
  const sea = calcProfit({ priceCny, weightKg, category, platform, method: 'sea', rate });

  let recommended = 'air';
  let reason = 'тренд короткий, морем не встигнути';

  if (horizon === 'season') {
    recommended = 'sea';
    reason = `сезонний товар, море економить ${sea.profitUah - air.profitUah} грн`;
  } else if (horizon === 'near' && sea.profitUah - air.profitUah > 200) {
    recommended = 'sea';
    reason = 'встигає до піку і вигідніше';
  }

  return { air, sea, recommended, reason };
}

// Найкраща платформа для товару.
export function bestPlatform({ priceCny, weightKg, category, rate, method = 'air' }) {
  const options = ['prom', 'rozetka', 'olx'].map((platform) =>
    calcProfit({ priceCny, weightKg, category, platform, method, rate })
  );
  options.sort((a, b) => b.profitUah - a.profitUah);
  return { best: options[0], all: options };
}

export { weightFor };
