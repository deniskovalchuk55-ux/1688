// Категорії, вікові групи і ключові слова, за якими система шукає сигнали.
// Редагується вільно — після зміни наступний збір підхопить нові слова.

export const CATEGORIES = [
  { id: 'toys', label: 'Іграшки' },
  { id: 'clothing_w', label: 'Одяг жіночий' },
  { id: 'clothing_m', label: 'Одяг чоловічий' },
  { id: 'clothing_kids', label: 'Одяг дитячий' },
  { id: 'shoes', label: 'Взуття' },
  { id: 'accessories', label: 'Аксесуари' },
  { id: 'gadgets', label: 'Гаджети' },
  { id: 'beauty', label: 'Косметика' },
  { id: 'home', label: 'Для дому' }
];

export const AGE_GROUPS = [
  { id: '5-15', label: '5–15' },
  { id: '15-18', label: '15–18' },
  { id: '18-23', label: '18–23' },
  { id: '23-29', label: '23–29' },
  { id: '30-35', label: '30–35' },
  { id: '35+', label: '35+' }
];

export const HORIZONS = [
  { id: 'now', label: 'Вже росте', note: 'пік у межах 2 тижнів' },
  { id: 'near', label: 'Найближче', note: '2–6 тижнів' },
  { id: 'season', label: 'Сезонне', note: '2–4 місяці' }
];

// Посівні запити. Система бере їх як стартову точку, міряє динаміку,
// а потім підтягує суміжні запити, які Google вважає пов'язаними.
export const SEEDS = [
  { q: 'іграшка антистрес', category: 'toys', age: '5-15' },
  { q: 'популярна іграшка', category: 'toys', age: '5-15' },
  { q: 'фіджет іграшка', category: 'toys', age: '5-15' },
  { q: 'інтерактивна іграшка', category: 'toys', age: '5-15' },
  { q: 'конструктор дитячий', category: 'toys', age: '5-15' },

  { q: 'жіноча куртка зимова', category: 'clothing_w', age: '18-23' },
  { q: 'жіночий спортивний костюм', category: 'clothing_w', age: '18-23' },
  { q: 'жіноча сукня', category: 'clothing_w', age: '23-29' },
  { q: 'жіночий светр оверсайз', category: 'clothing_w', age: '18-23' },

  { q: 'чоловіча куртка зимова', category: 'clothing_m', age: '23-29' },
  { q: 'чоловічий спортивний костюм', category: 'clothing_m', age: '18-23' },
  { q: 'чоловіче худі', category: 'clothing_m', age: '18-23' },
  { q: 'чоловіча жилетка', category: 'clothing_m', age: '23-29' },

  { q: 'дитяча зимова куртка', category: 'clothing_kids', age: '5-15' },
  { q: 'дитячий костюм', category: 'clothing_kids', age: '5-15' },

  { q: 'кросівки зимові', category: 'shoes', age: '18-23' },
  { q: 'жіночі черевики', category: 'shoes', age: '23-29' },
  { q: 'уги', category: 'shoes', age: '15-18' },

  { q: 'сумка крос боді', category: 'accessories', age: '18-23' },
  { q: 'шапка біні', category: 'accessories', age: '15-18' },
  { q: 'окуляри сонцезахисні', category: 'accessories', age: '18-23' },

  { q: 'павербанк', category: 'gadgets', age: '23-29' },
  { q: 'бездротові навушники', category: 'gadgets', age: '18-23' },
  { q: 'лампа нічник', category: 'gadgets', age: '23-29' },
  { q: 'зарядна станція', category: 'gadgets', age: '30-35' },

  { q: 'догляд за обличчям', category: 'beauty', age: '18-23' },
  { q: 'палетка тіней', category: 'beauty', age: '15-18' },

  { q: 'органайзер для дому', category: 'home', age: '30-35' },
  { q: 'термос', category: 'home', age: '23-29' }
];

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-zа-яіїєґ0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
