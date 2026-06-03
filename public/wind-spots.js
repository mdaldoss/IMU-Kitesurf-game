// Wind presets that mimic real kitesurf spots, plus the gust/thermal model.
// `effectiveWind(spot, tSec)` returns the instantaneous wind (kn) for a spot at
// time tSec — base strength, a deterministic gust wobble (sum of sines whose
// frequency/amplitude give each spot its "character"), and an optional thermal
// ramp that builds the wind over the session.

export function effectiveWind(spot, tSec) {
  const { baseWind, gust = 0, character = {}, thermal } = spot;
  const f1 = character.f1 ?? 0.7, a1 = character.a1 ?? 0.6;
  const f2 = character.f2 ?? 1.9, a2 = character.a2 ?? 0.4;
  const g = gust * 0.6;   // gust 0..1 -> up to ~±60% swing
  const wobble = g * (a1 * Math.sin(tSec * f1) + a2 * Math.sin(tSec * f2 + 1.3));

  let base = baseWind;
  if (thermal) {
    const r = Math.min(1, Math.max(0, tSec / thermal.rampSec));
    base = baseWind + (thermal.peak - baseWind) * r;   // builds toward peak
  }
  return Math.max(1, Math.min(60, base * (1 + wobble)));
}

// gust is a 0..1 fraction; character tunes the gust frequencies/amplitudes;
// thermal (optional) ramps base wind from `baseWind` to `peak` over `rampSec`.
export const SPOTS = [
  {
    id: 'tarifa-levante', name: 'Levante', region: 'Tarifa, ES',
    baseWind: 28, gust: 0.55, character: { f1: 0.9, a1: 0.6, f2: 2.3, a2: 0.5 },
    blurb: 'Strong, gusty easterly — punchy and demanding.',
  },
  {
    id: 'tarifa-poniente', name: 'Poniente', region: 'Tarifa, ES',
    baseWind: 20, gust: 0.2, character: { f1: 0.5, a1: 0.6, f2: 1.3, a2: 0.3 },
    blurb: 'Smoother westerly — steadier than the Levante.',
  },
  {
    id: 'maui', name: "Ho'okipa", region: 'Maui, US',
    baseWind: 22, gust: 0.25,
    blurb: 'Reliable trade winds, steady and clean.',
  },
  {
    id: 'garda-ora', name: 'Ora', region: 'Lake Garda, IT',
    baseWind: 16, gust: 0.18, thermal: { peak: 21, rampSec: 90 },
    blurb: 'Afternoon thermal that builds through the session.',
  },
  {
    id: 'capetown', name: 'SE “Doctor”', region: 'Cape Town, ZA',
    baseWind: 32, gust: 0.5, character: { f1: 0.8, a1: 0.6, f2: 2.0, a2: 0.5 },
    blurb: 'The Cape Doctor — strong, gusty south-easter.',
  },
  {
    id: 'dakhla', name: 'Dakhla', region: 'Dakhla, MA',
    baseWind: 20, gust: 0.15,
    blurb: 'Steady side-shore over flat lagoon water.',
  },
];

export const spotById = (id) => SPOTS.find((s) => s.id === id) || SPOTS[0];
