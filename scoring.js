// Оцінка тренду. Три складові, кожна 0–100.
//
// momentum   — наскільки швидко росте інтерес зараз
// volume     — наскільки взагалі великий попит
// confidence — чи підтверджують сигнал різні джерела
//
// score = зважена сума. Сортування в списку йде саме за нею.

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function momentumScore({ googleGrowthPct = 0, youtubeViewsPerDay = 0 }) {
  // Зростання пошуку на 40% за тиждень — це вже сильний сигнал.
  const search = clamp((googleGrowthPct / 40) * 60);
  // 50k переглядів на добу по темі — насичений інтерес.
  const video = clamp((youtubeViewsPerDay / 50000) * 40);
  return clamp(search + video);
}

export function volumeScore({ googleLatest = 0, youtubeTotalViews = 0 }) {
  const search = clamp(googleLatest * 0.6);
  const video = clamp((youtubeTotalViews / 2000000) * 40);
  return clamp(search + video);
}

export function confidenceScore({ sources = [], googleGrowthPct = 0 }) {
  const active = sources.filter(Boolean).length;
  const base = active >= 2 ? 60 : 30;
  // Дуже різкі стрибки часто виявляються шумом, а не трендом.
  const spikePenalty = googleGrowthPct > 400 ? 20 : 0;
  return clamp(base + Math.min(active * 10, 40) - spikePenalty);
}

export function totalScore({ momentum, volume, confidence }) {
  return Math.round(momentum * 0.5 + volume * 0.3 + confidence * 0.2);
}

// Груба оцінка, коли чекати пік. Швидке зростання = короткий цикл.
export function peakEstimate(momentum, googleGrowthPct) {
  if (googleGrowthPct > 150) return 'пік у межах 1–2 тижнів';
  if (momentum > 60) return 'пік за 2–4 тижні';
  if (momentum > 35) return 'пік за 1–2 місяці';
  return 'росте повільно, сезонний профіль';
}

export function horizonFor(googleGrowthPct, momentum) {
  if (googleGrowthPct > 120 || momentum > 65) return 'now';
  if (momentum > 35) return 'near';
  return 'season';
}
