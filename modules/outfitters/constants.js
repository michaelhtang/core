// Every number the Outfitters module uses, with where it came from and the day it was checked (2026-10-22). Integer cents and basis points (1 bp = 0.01%).
// `illustrative: 1` means no page could be read for that price, so it is a plausible round number chosen for teaching, not a quote.
// The catalogue is upserted into outfitters_items at every boot (docs/modules.md "Catalogues"): edit it here and restart. Prices can also be overridden per deployment with
// config.options.outfitters.prices = { "<item id>": cents }, and the planning return with config.options.outfitters.projectionBp.
export const CHECKED = '2026-10-22';

// GST. Alberta has no provincial sales tax, so a purchase carries the federal 5% only.
//   CRA, "GST/HST calculator (and rates)": Alberta 5% GST, 0% PST. Read 2026-10-22.
export const GST_BP = 500;
export const GST_URL = 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html';

// The "would grow to" line: what the total would be worth after PROJECTION_YEARS if it were invested instead, compounded yearly.
//   FP Canada / Institut de planification financiere, 2026 Projection Assumption Guidelines (released 2026-04-16, effective 2026-04-30):
//   short term 2.4%, fixed income 3.2%, Canadian equities 6.3%, U.S. equities 6.4%, international developed 6.6%, emerging 7.5%, inflation 2.1%.
//   We use the Canadian equity rate, 6.3% (630 bp), as the long-run planning return. EXACT-FIGURE WARNING: the FP Canada release lists Canadian 6.3% and
//   U.S. 6.4%; the Institute's own French-language page swaps them (6.4% / 6.6%). The release and the news coverage agree with each other, so 6.3% is used;
//   confirm against the official PDF before quoting it outside the classroom. The guidelines are meant for horizons of 10+ years; 5 years is a
//   classroom simplification (a real 5-year return is not guaranteed, and could be negative).
export const PROJECTION_BP = 630;
export const PROJECTION_YEARS = 5;
export const PROJECTION_URL = 'https://www.fpcanada.ca/newsdetail/fp-canada--and-the-institute-of-financial-planning-jointly-publish-the-2026-projection-assumption-guidelines-for-financial-planners';

// Resale: value = price paid (before GST) x (1 - depreciation) ^ months owned. Rates per month, in bp. ILLUSTRATIVE: no source publishes
// a resale curve for these goods; they are chosen so clothing loses about a third in a year, furniture about 17%, electronics about 26%.
export const DEPRECIATION_BP = { clothing: 400, furniture: 150, electronics: 250 };

const D = DEPRECIATION_BP;

// Icons: plain shapes only, inside public/svg-allow.js's allowlist (checked at boot by the module test and in the browser by buildingIcon).
const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICON = {
  tee: svg('<path d="M8 4L3 7l2 4 3-1v10h8V10l3 1 2-4-5-3c-.5 1.500-2 2.500-4 2.500S8.500 5.500 8 4z"/>'),
  jeans: svg('<path d="M7 3h10l1 18h-5l-1-10-1 10H6z"/><path d="M7 7h10"/>'),
  parka: svg('<path d="M8 4c0 2 1.500 3 4 3s4-1 4-3l4 3v5l-3 1v8H7v-8l-3-1V7z"/><path d="M12 7v14"/>'),
  toque: svg('<path d="M5 14a7 7 0 0 1 14 0z"/><path d="M5 14h14v3H5z"/><circle cx="12" cy="5" r="2"/>'),
  hoodie: svg('<path d="M9 4L3 7l2 5 3-1v9h8v-9l3 1 2-5-6-3c0 2-1 3-3 3S9 6 9 4z"/><path d="M10 13h4v3h-4z"/>'),
  sneakers: svg('<path d="M3 15c0-3 2-4 4-4l3 2h4c3 0 6 1 6 4v2H3z"/><path d="M3 19h18"/>'),
  designer: svg('<path d="M3 15c0-3 2-4 4-4l3 2h4c3 0 6 1 6 4v2H3z"/><path d="M3 19h18"/><path d="M12 4l1 2 2 .3-1.500 1.500.4 2L12 9l-1.900 1 .4-2L9 6.300 11 6z"/>'),
  boots: svg('<path d="M8 3h6v8l5 3v6H6V3z"/><path d="M6 17h13"/>'),
  case: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><circle cx="12" cy="7" r="1"/>'),
  puffer: svg('<path d="M8 4L3 7v6l3 1v6h12v-6l3-1V7l-5-3z"/><path d="M6 10h12M6 14h12M12 4v16"/>'),
  couch: svg('<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M3 11h2v4h14v-4h2v7H3z"/><path d="M5 18v2M19 18v2"/>'),
  sectional: svg('<path d="M3 8h12v6h6v5H3z"/><path d="M3 14h12"/>'),
  mattress: svg('<rect x="3" y="9" width="18" height="8" rx="2"/><path d="M3 17v2M21 17v2M8 9v8M13 9v8"/>'),
  desk: svg('<path d="M3 8h18v3H3z"/><path d="M5 11v9M19 11v9M12 11v4h5v-4"/>'),
  standing: svg('<path d="M3 7h18v2H3z"/><path d="M8 9v11M16 9v11M5 20h6M13 20h6"/>'),
  gaming: svg('<path d="M7 8h10a5 5 0 0 1 5 5v1a3 3 0 0 1-5.500 1.500L15 14H9l-1.500 1.500A3 3 0 0 1 2 14v-1a5 5 0 0 1 5-5z"/><path d="M7 11v3M5.500 12.500h3"/><circle cx="16" cy="12" r=".8"/>'),
  plants: svg('<path d="M8 14h8l-1 7H9z"/><path d="M12 14V8M12 10c-3 0-5-2-5-5 3 0 5 2 5 5zM12 12c3 0 5-2 5-5-3 0-5 2-5 5z"/>'),
  lamp: svg('<path d="M8 3h8l2 7H6z"/><path d="M12 10v10M8 20h8"/>'),
  art: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 16l5-5 4 4 3-3 4 4"/><circle cx="9" cy="8.500" r="1.500"/>'),
  bomber: svg('<path d="M8 4L3 8v8l3 1v3h12v-3l3-1V8l-5-4-2 2h-4z"/><path d="M12 6v14"/>'),
  keyring: svg('<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M17 17l2-2M14 14l2-2"/>'),
  watch: svg('<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 7l1-4h4l1 4M9 17l1 4h4l1-4M12 10v2.500l2 1"/>'),
  blazer: svg('<path d="M9 3l3 5 3-5 5 3-2 6v8H6v-8L4 6z"/><path d="M12 8l-1 12M12 8l1 12"/>'),
  umbrella: svg('<path d="M3 13a9 9 0 0 1 18 0z"/><path d="M12 13v6a2 2 0 0 1-4 0M12 4V3"/>'),
};

// Items for sale. slot: wardrobe head/top/bottom/shoes/accessory, home couch/bed/desk/tech/decor (equip one per slot). category: need | want (the FIN1010 lesson).
// Prices are before GST and before the price index. `anchor` rows are 2026 Canadian retail prices read from a page (url + what was read); the rest are illustrative.
const sale = (id, grp, slot, name, price_cents, category, dep, icon, sort, note, url = '', illustrative = 1) =>
  ({ id, grp, slot, name, price_cents, category, depreciation_bp_per_month: dep, icon: ICON[icon], unlock: null, sort, source_note: note, source_url: url, illustrative });

export const ITEMS = [
  sale('tee', 'wardrobe', 'top', 'Basic tee', 2000, 'need', D.clothing, 'tee', 10, 'Illustrative: a plain cotton tee at a Canadian retailer, about $20.'),
  sale('jeans', 'wardrobe', 'bottom', 'Everyday jeans', 6000, 'need', D.clothing, 'jeans', 20, 'Illustrative: a mid-range pair of jeans, about $60.'),
  sale('parka', 'wardrobe', 'top', 'Winter parka', 35000, 'need', D.clothing, 'parka', 30, 'Illustrative, and a need in Edmonton: a mid-range insulated parka, about $350. No 2026 Canadian retail page could be read (Mark\'s and Sport Chek pages returned 404, Columbia 403).'),
  sale('toque', 'wardrobe', 'head', 'Toque', 2500, 'need', D.clothing, 'toque', 40, 'Illustrative: a knit toque, about $25.'),
  sale('boots', 'wardrobe', 'shoes', 'Winter boots', 15000, 'need', D.clothing, 'boots', 50, 'Illustrative: insulated winter boots rated for Edmonton cold, about $150.'),
  sale('sneakers', 'wardrobe', 'shoes', 'Everyday sneakers', 7000, 'need', D.clothing, 'sneakers', 60, 'Illustrative: plain running shoes, about $70.'),
  sale('designer-sneakers', 'wardrobe', 'shoes', 'Designer sneakers', 28000, 'want', D.clothing, 'designer', 70, 'Illustrative: a fashion-brand sneaker, about $280. Same job as the $70 pair; this is the needs-vs-wants comparison.'),
  sale('puffer', 'wardrobe', 'top', 'Puffer jacket', 18000, 'want', D.clothing, 'puffer', 80, 'Illustrative: a name-brand puffer, about $180 (the lesson\'s example: $180 now, more later if invested).'),
  sale('wolves-hoodie', 'wardrobe', 'top', 'DAA Wolves hoodie', 6500, 'want', D.clothing, 'hoodie', 90, 'Illustrative: school-spirit hoodie, about $65.'),
  sale('phone-case', 'wardrobe', 'accessory', 'Phone case', 3000, 'want', D.clothing, 'case', 100, 'Illustrative: a branded phone case, about $30.'),
  sale('used-couch', 'home', 'couch', 'Second-hand couch', 25000, 'need', D.furniture, 'couch', 110, 'Illustrative: a used couch from a local marketplace, about $250.'),
  sale('sectional', 'home', 'couch', 'New sectional', 180000, 'want', D.furniture, 'sectional', 120, 'Illustrative: a new 3-piece sectional, about $1,800.'),
  sale('mattress', 'home', 'bed', 'Mattress (queen)', 89500, 'need', D.furniture, 'mattress', 130,
    'Endy queen mattress listed at $895 on endy.com (Canadian site, currency not stated on the page, read 2026-10-22).', 'https://endy.com/products/endy-mattress', 0),
  sale('desk', 'home', 'desk', 'Desk', 19900, 'need', D.furniture, 'desk', 140,
    'IKEA Canada desks category, read 2026-10-22: LAGKAPTEN / ALEX desk, white, 120x60 cm, $199 (MICKE $149 and MALM $249 on the same page).', 'https://www.ikea.com/ca/en/cat/desks-20649/', 0),
  sale('standing-desk', 'home', 'desk', 'Standing desk', 65000, 'want', D.furniture, 'standing', 150, 'Illustrative: an electric sit-stand desk, about $650.'),
  sale('gaming', 'home', 'tech', 'Gaming setup (console + controller)', 74999, 'want', D.electronics, 'gaming', 160,
    'PlayStation 5 Digital Edition at C$749.99 after Sony\'s Canadian price rise on April 2, 2026 (tech-insider.org, a secondary source; Sony\'s own page not read), read 2026-10-22.', 'https://tech-insider.org/ps5-pro-vs-ps5-canada-2026/', 0),
  sale('plants', 'home', 'decor', 'Plants', 4500, 'want', D.furniture, 'plants', 170, 'Illustrative: two houseplants and pots, about $45.'),
  sale('lamp', 'home', 'decor', 'Study lamp', 3500, 'need', D.furniture, 'lamp', 180, 'Illustrative: a floor or desk lamp, about $35.'),
  sale('wall-art', 'home', 'decor', 'Wall art', 6000, 'want', D.furniture, 'art', 190, 'Illustrative: a framed print, about $60.'),
];

// Achievement items: never for sale, price 0, unlocked by a fact (the events in index.js). No resale.
const reward = (id, grp, slot, name, icon, unlock, sort, note) =>
  ({ id, grp, slot, name, price_cents: 0, category: 'want', depreciation_bp_per_month: 0, icon: ICON[icon], unlock, sort, source_note: note, source_url: '', illustrative: 1 });

export const ACHIEVEMENTS = [
  { key: 'credit750', item: reward('bomber-750', 'wardrobe', 'top', '"Credit 750+" bomber jacket', 'bomber', 'credit750', 300, 'Earned, not bought.'),
    how: 'Reach a credit score of 750 (Credit Bureau).' },
  { key: 'firstkeys', item: reward('first-keys', 'wardrobe', 'accessory', '"First keys" key-ring', 'keyring', 'firstkeys', 310, 'Earned, not bought.'),
    how: 'Own a home for the first time (Housing).' },
  { key: 'ontime', item: reward('on-time-watch', 'wardrobe', 'accessory', '"On time" watch', 'watch', 'ontime', 320, 'Earned, not bought.'),
    how: 'Pay every bill on time for 6 world months in a row, with no late bill.' },
  { key: 'promoted', item: reward('promoted-blazer', 'wardrobe', 'top', '"Promoted" blazer', 'blazer', 'promoted', 330, 'Earned, not bought.'),
    how: 'Get a promotion at work (Job Centre).' },
  { key: 'emergency', item: reward('emergency-umbrella', 'wardrobe', 'accessory', '"Emergency fund" umbrella', 'umbrella', 'emergency', 340, 'Earned, not bought.'),
    how: 'Save 3 months of bills in your high-interest savings account.' },
];

// Venture Row goods: a purchase from a student company's storefront (the ventures module) comes with the item for that company's sector, through
// this module's grantItem service. Never for sale here (unlock 'venture'), price 0 and no resale: the buyer paid the company, not this store.
export const VENTURE_ITEMS = Object.fromEntries([
  ['Food and drink', 'vr-mug', 'home', 'decor', 'Venture Row cafe mug', 'plants'],
  ['Business services', 'vr-cardcase', 'wardrobe', 'accessory', 'Business card case', 'case'],
  ['Convenience retail', 'vr-tote', 'wardrobe', 'accessory', 'Corner-shop key-ring', 'keyring'],
  ['Restaurants', 'vr-menu', 'home', 'decor', 'Framed menu', 'art'],
  ['Clothing retail', 'vr-tee', 'wardrobe', 'top', 'Student-label tee', 'tee'],
  ['Electrical contracting', 'vr-lamp', 'home', 'decor', 'Hand-wired lamp', 'lamp'],
  ['Customer service tech', 'vr-headset', 'home', 'tech', 'Support-desk headset', 'gaming'],
  ['Warehousing and freight', 'vr-crate', 'home', 'desk', 'Delivery-crate desk', 'desk'],
].map(([sector, id, grp, slot, name, icon], i) => [sector, reward(id, grp, slot, name, icon, 'venture', 400 + i, 'Bought from a student company on Venture Row.')]));

const SEED_ITEMS = [...ITEMS, ...ACHIEVEMENTS.map((a) => a.item)];   // what migration 001 seeded (kept as it was, so its checksum does not change)
export const ALL_ITEMS = [...SEED_ITEMS, ...Object.values(VENTURE_ITEMS)];

export const STREAK_MONTHS = 6;          // "On time" watch
export const EMERGENCY_MONTHS = 3;       // "Emergency fund" umbrella: HISA >= 3 x monthly bills
export const SCORE_GOAL = 750;           // "Credit 750+"

// Class goals: when GOAL_SHARE_PCT of a class's students meet a goal in a world month, the class unlocks a Wolf outfit. `outfit` is the art key
// (public/art/wolf-<outfit>.png once ComfyUI art exists); until then the corner mascot stays the plain wolf.
export const GOAL_SHARE_PCT = 80;
export const GOAL_MEDIAN_SCORE = 700;
export const GOALS = [
  { key: 'ontime', outfit: 'suit', outfitName: 'Suit Wolf', name: 'Everyone pays every bill on time', how: '80% of the class paid every bill on time last month, with none late.' },
  { key: 'credit', outfit: 'grad', outfitName: 'Grad Wolf', name: 'A class credit score of 700', how: 'The class median credit score is 700 or more, and at least 80% of the class has a score.' },
];

// The rows outfitters_items holds, upserted at every boot (docs/modules.md "Catalogues").
export const itemRows = () => ALL_ITEMS.map(({ depreciation_bp_per_month, ...i }) => ({ ...i, dep_bp: depreciation_bp_per_month, checked: CHECKED }));

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
export const seedSql = () => SEED_ITEMS.map((i) =>
  `INSERT INTO outfitters_items (id, grp, slot, name, price_cents, category, dep_bp, icon, unlock, sort, source_note, source_url, checked, illustrative) VALUES (${[
    q(i.id), q(i.grp), q(i.slot), q(i.name), i.price_cents, q(i.category), i.depreciation_bp_per_month, q(i.icon), i.unlock ? q(i.unlock) : 'NULL', i.sort,
    q(i.source_note), q(i.source_url), q(CHECKED), i.illustrative].join(', ')});`).join('\n');

// Integer math, so a price never drifts by a float: BigInt for (1 + r)^n and (1 - r)^n.
const pow = (cents, num, den, n) => Number((BigInt(cents) * BigInt(num) ** BigInt(n)) / (BigInt(den) ** BigInt(n)));
export const gstOf = (priceCents, bp = GST_BP) => Math.round((priceCents * bp) / 10000);
export const growTo = (cents, bp = PROJECTION_BP, years = PROJECTION_YEARS) => pow(cents, 10000 + bp, 10000, years);     // floored to the cent
export const resaleValue = (priceCents, depBp, months) => pow(priceCents, 10000 - depBp, 10000, Math.max(0, months));    // floored to the cent
