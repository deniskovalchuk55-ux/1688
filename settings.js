// Усі цифри, які впливають на розрахунок прибутку.
// Правиш тут — наступний перерахунок підхопить.

export const SETTINGS = {
  // Скільки гривень за юань. Оновлюється автоматично з НБУ,
  // це значення використовується лише якщо курс не вдалось отримати.
  cnyToUahFallback: 5.8,

  // Доставка Meest China. Ціна за кілограм у гривнях.
  // ЗАМІНИ на свої реальні тарифи з кабінету.
  delivery: {
    air: {
      label: 'Авіа',
      days: 14,
      perKg: 420,
      minCharge: 120
    },
    sea: {
      label: 'Море',
      days: 60,
      perKg: 130,
      minCharge: 60
    }
  },

  // Доставка всередині Китаю до складу Meest, у юанях за одиницю.
  // Приблизна, бо залежить від продавця.
  chinaInlandCny: 8,

  // Комісії майданчиків, відсотки за категоріями.
  commissions: {
    prom: { default: 12, toys: 14, gadgets: 16, beauty: 15 },
    rozetka: { default: 18, toys: 20, gadgets: 14, beauty: 17 },
    olx: { default: 0 }
  },

  // Пороги відбору. Товари, що не проходять, не показуються.
  // На 1688 немає звичного рейтингу продавця, тому надійність
  // оцінюємо за продажами, віком магазину і часткою повторних покупок.
  filters: {
    minProfitUah: 250,
    minSold: 30,           // скільки разів товар уже купили
    minSellerYears: 2,     // скільки років магазину
    minReturnRate: 20,     // відсоток покупців, що повернулись
    maxProducts: 5
  },

  // Скільки трендів із верхівки рейтингу шукати на 1688 за один цикл.
  // Більше — дорожче за запитами, тому починаємо обережно.
  sourcingTopN: 8,

  // Орієнтовна вага за категоріями, кг. Використовується,
  // коли продавець не вказав вагу.
  defaultWeightKg: {
    toys: 0.3,
    clothing_w: 0.5,
    clothing_m: 0.6,
    clothing_kids: 0.35,
    shoes: 0.9,
    accessories: 0.2,
    gadgets: 0.4,
    beauty: 0.2,
    home: 0.5,
    _default: 0.5
  }
};

export function commissionFor(platform, category) {
  const table = SETTINGS.commissions[platform] || {};
  return table[category] ?? table.default ?? 0;
}

export function weightFor(category) {
  return SETTINGS.defaultWeightKg[category] ?? SETTINGS.defaultWeightKg._default;
}
