// The news ticker: one to four headlines per world month from fixed templates, picked by a hash of the month and ticker (so a rerun reads the same).
// Pure: the caller passes what happened. Priority: market events, the bond fund and the policy rate, a dividend, the index level, the biggest movers.
import { hash32 } from './prices.js';
import { EVENTS } from './constants.js';

const pick = (list, key) => list[hash32(key) % list.length];
const pct = (x) => `${Math.abs(x * 100).toFixed(1)}%`;
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

// input: { month, events: [{ kind, ticker, name, headline? (used as the text when set) }], rate: { deltaBp, bondPct } | null, dividend: { ticker, name, perUnitCents } | null,
//          index: { price (cents), change } , movers: [{ ticker, name, change }] (stocks, any order) }
export function headlines({ month, events = [], rate = null, dividend = null, index, movers = [] }) {
  const out = [];
  for (const e of events.slice(0, 2)) {
    const ev = EVENTS[e.kind];
    if (!ev) continue;
    const text = e.headline || {
      crash: pick(['Markets tumble: a sharp sell-off hits every stock in town', 'Crash on the Exchange: stocks fall hard, bonds dip'], `${month}:crash`),
      correction: pick(['A market correction: stocks give back some gains', 'Stocks slip as the market cools off'], `${month}:corr`),
      rally: pick(['Rally on the Exchange: stocks climb across the board', 'Buyers return and the market jumps'], `${month}:rally`),
      scandal: `${e.name ?? e.ticker} (${e.ticker}) hit by scandal: shares plunge`,
      boom: `${e.name ?? e.ticker} (${e.ticker}) booms: shares jump on strong demand`,
    }[e.kind];
    out.push({ kind: 'event', ticker: e.ticker ?? null, text });
  }
  if (rate && rate.deltaBp !== 0) {
    const up = rate.deltaBp > 0;
    out.push({ kind: 'rate', ticker: 'DAAB', text: `Policy rate ${up ? 'up' : 'down'} ${Math.abs(rate.deltaBp)} bp: the DAA Bond Index ${rate.bondPct >= 0 ? 'rises' : 'falls'} ${pct(rate.bondPct)} as bond prices move the opposite way` });
  }
  if (dividend) out.push({ kind: 'dividend', ticker: dividend.ticker, text: `${dividend.name} (${dividend.ticker}) pays a dividend of ${money(dividend.perUnitCents)} a share` });
  out.push({ kind: 'index', ticker: 'DAAX', text: `DAA Total Market Index ${index.change >= 0 ? 'gains' : 'loses'} ${pct(index.change)} to ${money(index.price)}` });
  const ranked = [...movers].sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.ticker.localeCompare(b.ticker));
  for (const m of ranked.slice(0, 2)) {
    const up = m.change >= 0;
    const verb = pick(up ? ['jumps', 'climbs', 'rises'] : ['drops', 'slides', 'falls'], `${month}:${m.ticker}`);
    out.push({ kind: 'mover', ticker: m.ticker, text: `${m.name} (${m.ticker}) ${verb} ${pct(m.change)}` });
  }
  return out.slice(0, 4);
}
