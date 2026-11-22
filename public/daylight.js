// Day or night in Edmonton, from real sunrise and sunset (NOAA's solar-position equations; the standard sunrise altitude −0.833°
// for refraction and the sun's radius). Shared by the browser (the scene's day/night photo) and the tests.
export const EDMONTON = { lat: 53.5461, lon: -113.4938 };
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Sunrise and sunset for the UTC calendar day that starts at utcMidnightMs, as UTC ms (sunset may fall on the next UTC day).
export function sunTimes(utcMidnightMs, { lat, lon } = EDMONTON) {
  const d = new Date(utcMidnightMs);
  const n = Math.round((utcMidnightMs - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1;   // day of the year
  const g = (2 * Math.PI / 365) * (n - 1);                                                      // fractional year at noon UTC
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosHa = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl);
  if (cosHa <= -1) return { sunrise: utcMidnightMs, sunset: utcMidnightMs + 864e5 };          // midnight sun (not at Edmonton's latitude)
  if (cosHa >= 1) return { sunrise: null, sunset: null };                                        // polar night
  const ha = deg(Math.acos(cosHa));
  return {
    sunrise: utcMidnightMs + (720 - 4 * (lon + ha) - eqtime) * 60e3,
    sunset: utcMidnightMs + (720 - 4 * (lon - ha) - eqtime) * 60e3,
  };
}

// 'day' between sunrise and sunset, else 'night'. Edmonton's sunset falls after UTC midnight, so the previous UTC day is checked too.
export function daypart(nowMs = Date.now(), place = EDMONTON) {
  const midnight = Math.floor(nowMs / 864e5) * 864e5;
  for (const m of [midnight - 864e5, midnight, midnight + 864e5]) {
    const { sunrise, sunset } = sunTimes(m, place);
    if (sunrise !== null && nowMs >= sunrise && nowMs < sunset) return 'day';
  }
  return 'night';
}

// Keeps el.dataset.daypart current (checked every minute). ?daypart=day or ?daypart=night in the address pins it, for previews.
export function startDaylight(el) {
  const pinned = new URLSearchParams(location.search).get('daypart');
  const set = () => { el.dataset.daypart = pinned === 'day' || pinned === 'night' ? pinned : daypart(); };
  set();
  if (!pinned) setInterval(set, 60e3);
}
