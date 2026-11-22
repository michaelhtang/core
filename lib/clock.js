// The one source of wall time (docs/clock.md). Everything else in lib/ and modules/ asks a clock, never Date.now().
// Wall time protects the system (sessions, throttles, caps, audit stamps); world time (worlds.month) is what students learn about.
const TZ = 'America/Edmonton';

// No-school entries (docs/clock.md): 'YYYY-MM-DD' or 'YYYY-MM-DD to YYYY-MM-DD' (inclusive). Returns the canonical list or throws
// an Error naming the bad entry. A date must exist on the calendar (2027-02-30 is refused) and a range must not run backwards.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (d) => DAY.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
export function parseNoSchool(list) {
  if (!Array.isArray(list) || list.length > 200) throw new Error('No-school days must be a list of at most 200 dates or ranges');
  return list.map((e) => {
    const [a, b, extra] = typeof e === 'string' ? e.trim().split(/\s+to\s+/) : [];
    if (!realDay(a) || (b !== undefined && !realDay(b)) || extra !== undefined) throw new Error(`"${e}" is not a date like 2027-02-15 or a range like 2027-03-30 to 2027-04-02`);
    if (b !== undefined && b < a) throw new Error(`"${e}" ends before it starts`);
    return b === undefined || b === a ? a : `${a} to ${b}`;
  });
}
const listed = (list, d) => list.some((e) => { const [a, b = a] = e.split(' to '); return d >= a && d <= b; });

export function createClock({ now = () => Date.now(), tz = TZ, noSchool = [] } = {}) {
  noSchool = parseNoSchool(noSchool);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hourOf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' });
  return {
    tz,
    now: () => now(),
    today: () => day.format(now()),                      // 'YYYY-MM-DD' in tz
    dayOf: (ms) => day.format(ms),                       // the same, for any timestamp
    hour: () => Number(hourOf.format(now())),            // 0-23 in tz
    // Mon-Fri and not on the no-school list (a world's own list, parsed, else the clock's default from config.calendar.noSchool).
    // A calendar date has the same weekday everywhere, so read it at noon UTC.
    isSchoolDay(d, list) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      return dow >= 1 && dow <= 5 && !listed(Array.isArray(list) ? list : noSchool, d);   // not an array (e.g. .map's index): the default
    },
  };
}

// 'YYYY-MM-DD' plus n whole days (calendar arithmetic, so no time zone or DST in it).
export const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
