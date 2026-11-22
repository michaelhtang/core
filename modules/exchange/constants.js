// exchange: every number in one place, with where it came from. SOURCES_CHECKED = 2026-10-22. Money is integer cents (the ledger); prices are integer
// micro-cents (1 micro-cent = 1e-4 cent = 1e-6 dollar, PRICE_SCALE per cent); fund and share amounts are integer micro-units (UNIT per whole unit).
// Anything marked ILLUSTRATIVE could not be read from a page and is a teaching figure, not a quote.
import { CATALOGUE } from '../jobs/catalogue.js';   // the employers' names only (a module may read another's source constants, never its tables)

export const SOURCES_CHECKED = '2026-10-22';

// ---- return assumptions ----
// FP Canada and the Institute of Financial Planning (IQPF), 2026 Projection Assumption Guidelines, published 2026-04-16, in force 2026-04-30:
//   inflation 2.1%, short-term 2.4%, fixed income 3.2%, Canadian equities 6.3%, US equities 6.4%, international developed 6.6%, emerging 7.5% (nominal, 10+ year projections).
//   https://fpcanada.ca/newsdetail/fp-canada--and-the-institute-of-financial-planning-jointly-publish-the-2026-projection-assumption-guidelines-for-financial-planners
//   Read 2026-10-22 on FP Canada's release and three trade-press reports (6.3% / 6.4%). The IQPF's own communique (institutpf.org) lists 6.4% / 6.6% for the same two rows
//   (reversed), so the PDF was not confirmed: 6.3% is used, the figure FP Canada's own page gives.
// The guidelines are for 10+ years; the game's price model uses them as the expected annual return (a simplification, not a forecast).
export const EQUITY_RETURN_BP = 630;
export const FIXED_INCOME_BP = 320;
export const GUIDELINES_URL = 'https://fpcanada.ca/newsdetail/fp-canada--and-the-institute-of-financial-planning-jointly-publish-the-2026-projection-assumption-guidelines-for-financial-planners';

// ---- fees (MER = management expense ratio, a percent of the fund a year, taken out of the price bit by bit: MER/12 a month) ----
//   DAAX 0.06%: iShares Core S&P/TSX Capped Composite Index ETF (XIC), MER 0.06%, management fee 0.05% (Cboe Canada ETF comparison pages, Apr-May 2026,
//     https://etfmarket.cboe.com/canada/en/etf-comparison/XIC-vs-VCN; checked 2026-10-22). BlackRock's own page did not show Key Facts when read.
//   DAAB 0.10%: iShares Canadian Universe Bond Index ETF (XBB), expense ratio 0.10% (TradingView and Pensions & Investments listings, 2026;
//     https://www.tradingview.com/symbols/TSX-XBB/analysis; checked 2026-10-22). One older page said 0.33%; the newer listings agree on 0.10%.
//   DAAG 0.20%: ILLUSTRATIVE. All-in-one balanced ETFs from the big issuers charge about 0.20-0.25%; no fund page was read.
export const MER_BP = { DAAX: 6, DAAB: 10, DAAG: 20 };
// Duration: how much a bond fund's price falls for each 1 percentage point the policy rate rises (about 7% for a broad Canadian bond ETF).
//   ILLUSTRATIVE: a broad Canadian universe bond fund's effective duration is commonly about 7 years; BlackRock's page did not show it when read.
export const BOND_DURATION = 7;

// ---- the TFSA ----
// CRA: the 2026 TFSA dollar limit is $7,000 (announced 2025-12-01). Room = the limit each year + unused room carried forward + last year's withdrawals - contributions;
// withdrawals come back as room on January 1 of the NEXT year. The CRA charges 1% a month on an over-contribution; the game refuses it up front instead.
//   https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributing/calculate-room.html (checked 2026-10-22)
export const TFSA_LIMIT_CENTS = 700000;
export const TFSA_URL = 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributing/calculate-room.html';

// ---- the RRSP (wave 3b) ----
// CRA, "MP, DB, RRSP, DPSP, ALDA, TFSA limits, YMPE and the YAMPE": the 2026 RRSP dollar limit is $33,810 (read 2026-10-22; the same page gives the TFSA limit $7,000).
//   https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html
// New room each year = 18% of the PREVIOUS year's earned income, up to that limit; unused room carries forward. A withdrawal never gives room back.
// The real $2,000 over-contribution buffer and the 1% a month penalty are not modelled: the game refuses an over-contribution up front.
export const RRSP_LIMIT_CENTS = 3381000;
export const RRSP_EARNED_PCT = 18;
// CRA, "Tax rates on withdrawals" (canada.ca), outside Quebec, on the amount of ONE withdrawal: 10% up to $5,000, 20% over $5,000 up to $15,000, 30% over $15,000.
//   https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/making-withdrawals/tax-rates-on-withdrawals.html (read 2026-10-22)
// [top of the band in cents (inclusive), percent withheld]; the whole withdrawal is withheld at its band's rate.
export const RRSP_WITHHOLDING = [[500000, 10], [1500000, 20], [Infinity, 30]];
export const RRSP_URL = 'https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html';
// TFSA vs RRSP comparison on the panel: $1,000 for 30 years. The two other retirement tax rates are ILLUSTRATIVE (a lower and a higher rate than a student's today).
export const COMPARE_CENTS = 100000;
export const COMPARE_YEARS = 30;
export const COMPARE_RETIRE_BP = [1500, 3000];

// ---- fixed point ----
export const PRICE_SCALE = 10000;       // micro-cents per cent
export const UNIT = 1000000;            // micro-units per whole unit (share or fund unit)
export const FUND_STEP = 100;           // funds trade in steps of 0.0001 unit
export const STOCK_STEP = UNIT;         // stocks trade in whole shares (a DRIP may buy a fraction)

// ---- the market maker ----
export const SPREAD_BP = { fund: 20, stock: 100 };   // bid-ask spread, split evenly around the price: ask = price x (1 + spread/2), bid = price x (1 - spread/2)
export const CORRELATION = 0.6;                       // equities (stocks and the index fund) share one market factor
export const Z_CAP = 3.5;                             // a standard normal draw is clipped to +-3.5 so no month is absurd
export const MIN_PRICE_MICRO = PRICE_SCALE;           // a price never falls below one cent

// ---- guardrails (PLAN section 6) ----
export const ORDERS_PER_MONTH = 10;
export const ORDER_SHARE_PCT = 50;                    // one buy order may commit at most half of the student's investable cash
export const BREAKER_PCT = 20;                        // a security whose normal monthly move is over 20% pauses for the rest of that world month
export const LIMIT_EXPIRY_MONTHS = 3;
export const DIVIDEND_MONTHS = [3, 6, 9, 12];         // world months of each world year

// ---- market events (world teacher); the factor is what the price is multiplied by, on top of that tick's normal step ----
export const EVENTS = {
  crash: { name: 'Market crash', equityPct: -25, bondPct: -5, scope: 'market' },
  correction: { name: 'Market correction', equityPct: -10, bondPct: 0, scope: 'market' },
  rally: { name: 'Market rally', equityPct: 10, bondPct: 0, scope: 'market' },
  scandal: { name: 'Company scandal', stockPct: -35, scope: 'stock' },
  boom: { name: 'Company boom', stockPct: 25, scope: 'stock' },
};

// ---- the funds ----
// type 'equity' | 'bond' | 'blend'. start prices are micro-cents ($100.00 = 10,000 cents = 100,000,000 micro-cents).
export const FUNDS = [
  { ticker: 'DAAX', name: 'DAA Total Market Index', kind: 'fund', type: 'equity', startMicro: 100 * 100 * PRICE_SCALE, muBp: EQUITY_RETURN_BP, sigmaBp: 1500, merBp: MER_BP.DAAX, note: 'Every company in town in one fund. Moves with the whole market.' },
  { ticker: 'DAAB', name: 'DAA Bond Index', kind: 'fund', type: 'bond', startMicro: 100 * 100 * PRICE_SCALE, muBp: FIXED_INCOME_BP, sigmaBp: 500, merBp: MER_BP.DAAB, durationYears: BOND_DURATION, note: 'Loans to governments and companies. Steadier than stocks, and it falls when the policy rate rises.' },
  { ticker: 'DAAG', name: 'DAA Balanced 60/40', kind: 'fund', type: 'blend', startMicro: 100 * 100 * PRICE_SCALE, merBp: MER_BP.DAAG, blend: { DAAX: 60, DAAB: 40 }, note: '60% index fund and 40% bond fund, rebalanced every month.' },
];

// ---- the town's companies: fictional, named after the Job Centre's employers (so you can own shares in your own employer) ----
// muBp is the TOTAL expected return (price growth + dividends) = the equity guideline + the sector tilt; the price model removes the dividend yield from the growth so
// dividends are not counted twice. Tilts, volatilities, yields and start prices are ILLUSTRATIVE teaching numbers.
const stock = (ticker, employer, sector, sigmaBp, tiltBp, yieldBp, startDollars, note) => ({
  ticker, name: employer, kind: 'stock', type: 'equity', sector, sigmaBp, muBp: EQUITY_RETURN_BP + tiltBp, yieldBp, startMicro: startDollars * 100 * PRICE_SCALE, merBp: 0, note,
});
export const STOCKS = [
  stock('AGRA', 'Agora Coffee Co.', 'Food and drink', 2800, -50, 150, 42, 'Cafes around town. Steady customers, modest growth.'),
  stock('BEAC', 'Beacon Business Services', 'Business services', 2500, 0, 300, 58, 'Offices and admin. Calm and pays a good dividend.'),
  stock('CORN', 'Corner Mart', 'Convenience retail', 2500, -100, 350, 31, 'Everyday items. Defensive: it moves less and pays the most.'),
  stock('MAPL', 'Maple Street Grill', 'Restaurants', 3800, 50, 100, 24, 'Sit-down dining. Busy in good times, hit hard in bad ones.'),
  stock('PRAI', 'Prairie Threads', 'Clothing retail', 4200, 100, 0, 36, 'Fashion. High growth hopes, no dividend, bumpy ride.'),
  stock('SPRK', 'Spark Line Electric', 'Electrical contracting', 3000, 50, 250, 65, 'Wiring the new builds. Growing with the town.'),
  stock('CALL', 'Callpoint Support', 'Customer service tech', 4500, 150, 0, 19, 'The most volatile stock in town: big hopes, no dividend.'),
  stock('KEYS', 'Keystone Distribution', 'Warehousing and freight', 3300, 0, 200, 47, 'Moves goods through town. Follows the economy.'),
];
export const SECURITIES = [...FUNDS, ...STOCKS];
export const EMPLOYERS = new Set(CATALOGUE.map((c) => c.employer));

export const spreadOf = (s) => SPREAD_BP[s.kind];
export const stepOf = (s) => (s.kind === 'fund' ? FUND_STEP : STOCK_STEP);
