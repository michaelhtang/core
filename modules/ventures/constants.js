// ventures: every number in one place, with where it came from. Checked 2026-10-23. Money is integer cents; shares are integer micro-units
// (UNIT per whole share, as on the exchange); rates and shares of a whole in basis points (10000 = 100%).
// Anything marked ILLUSTRATIVE is a teaching figure chosen to give sensible prices and margins, not a quote.
import { STOCKS, UNIT } from '../exchange/constants.js';   // the town sectors and the share unit (a source constants file, never a table)

export { UNIT };
export const SECTORS = [...new Set(STOCKS.map((s) => s.sector))];

// ---- founding ----
export const FOUNDING_COURSES = ['fintech2030'];   // FT20/30 found companies; FT10 students are customers (4a), staff and small investors (4b/4c)
export const MIN_COFOUNDERS = 1, MAX_COFOUNDERS = 3;   // teams of 2 to 4
export const MIN_CAPITAL_CENTS = 10000;            // each founder puts in at least $100 from chequing
export const FOUNDER_UNITS = 1000 * UNIT;          // 1,000 founder shares, split by agreement (equal by default)
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 &'.,!-]{2,39}$/;   // 3 to 40 characters
export const PLAN_MIN = 40, PLAN_MAX = 800;
// A short blocklist (the teacher can rename anything that slips through): whole words, plus roots that are never part of an innocent word.
export const BLOCK_WORDS = new Set(['ass', 'arse', 'bitch', 'bastard', 'crap', 'damn', 'dick', 'cock', 'piss', 'slut', 'whore', 'fag', 'rape', 'nazi', 'hitler', 'porn', 'sex', 'kkk', 'retard', 'kill']);
export const BLOCK_ROOTS = ['fuck', 'shit', 'cunt', 'nigg', 'faggot', 'retard'];

// ---- products ----
export const MAX_PRODUCTS = 3;
export const MAX_QUANTITY = 10000;     // units a month per product
export const PRICE_CAP_X = 3;          // price-gouging limit: a price is at most 3 x the unit cost (applies to every sale, NPC and classmate)
// Unit cost = materials + time. Time is costed at Alberta's general minimum wage, $15.00 an hour (25 cents a minute): Government of Alberta,
//   "Minimum wage" (https://www.alberta.ca/minimum-wage), the same $15.00/h floor the Job Centre's catalogue uses (modules/jobs/catalogue.js).
// Materials, minutes, demand (a = units a month per 100 students at a price of 0) and the choke price (the price at which nobody buys) are
// ILLUSTRATIVE: plausible small-business figures picked so the revenue-maximising price (half the choke price) is 2 to 3 x the unit cost.
export const MINUTE_CENTS = 25;
export const COST_URL = 'https://www.alberta.ca/minimum-wage';
const row = (sector, key, name, materials_cents, minutes, a100, choke_cents) => ({ sector, key, name, materials_cents, minutes, a100, choke_cents });
export const PRODUCTS = [
  row('Food and drink', 'coffee', 'Drip coffee', 90, 4, 200, 800),
  row('Food and drink', 'muffin', 'Baked muffin', 110, 6, 180, 900),
  row('Food and drink', 'smoothie', 'Fruit smoothie', 200, 6, 130, 1200),
  row('Business services', 'resume', 'Resume review', 50, 40, 35, 4500),
  row('Business services', 'posters', 'Poster printing (10)', 400, 20, 45, 3600),
  row('Business services', 'books', 'Bookkeeping hour', 100, 60, 23, 7000),
  row('Convenience retail', 'snacks', 'Snack pack', 120, 2, 160, 1000),
  row('Convenience retail', 'charger', 'Phone charger', 600, 2, 45, 3500),
  row('Convenience retail', 'supplies', 'School supplies kit', 400, 4, 57, 2800),
  row('Restaurants', 'lunch', 'Lunch special', 450, 14, 80, 2000),
  row('Restaurants', 'pizza', 'Large pizza', 600, 16, 62, 2600),
  row('Restaurants', 'catering', 'Catering tray', 3000, 60, 15, 11000),
  row('Clothing retail', 'tee', 'Screen-printed tee', 700, 12, 53, 3000),
  row('Clothing retail', 'hoodie', 'Hoodie', 1600, 20, 27, 6000),
  row('Clothing retail', 'tote', 'Tote bag', 400, 8, 89, 1800),
  row('Electrical contracting', 'repair', 'Lamp repair', 300, 40, 32, 5000),
  row('Electrical contracting', 'desklamp', 'LED desk lamp', 1200, 30, 23, 7000),
  row('Electrical contracting', 'outlet', 'Outlet install', 800, 60, 18, 9000),
  row('Customer service tech', 'helpdesk', 'Help-desk hour', 100, 60, 27, 6000),
  row('Customer service tech', 'website', 'Website fix', 200, 80, 19, 8500),
  row('Customer service tech', 'chatbot', 'Chatbot setup', 500, 120, 11, 14000),
  row('Warehousing and freight', 'delivery', 'Local delivery', 300, 25, 46, 3500),
  row('Warehousing and freight', 'storage', 'Storage bin (a month)', 400, 6, 73, 2200),
  row('Warehousing and freight', 'moving', 'Moving help hour', 200, 60, 25, 6500),
];
export const productType = (key) => PRODUCTS.find((p) => p.key === key) ?? null;
// Unsold units lost each month, per sector (bp). ILLUSTRATIVE. A service hour nobody bought is gone, so service sectors lose all of it.
export const SPOILAGE_BP = {
  'Food and drink': 4000, Restaurants: 7500, 'Convenience retail': 300, 'Clothing retail': 200,
  'Business services': 10000, 'Electrical contracting': 10000, 'Customer service tech': 10000, 'Warehousing and freight': 10000,
};
// Price sensitivity: 'elastic' sectors have a choke price close to the unit cost (customers walk away fast), 'inelastic' ones a high one.
export const ELASTICITY = { Restaurants: 'elastic', 'Clothing retail': 'elastic', 'Convenience retail': 'inelastic', 'Food and drink': 'inelastic' };

// ---- NPC demand ----
// Town customers are the town's NPC residents, not the students: every sector's demand curve is the one a town of TOWN_SIZE residents gets,
// whatever the size of the school (config.options.ventures.townSize: the size of the simulated town, not the school). A bigger school means
// more student companies splitting the same town, not a bigger town. The a figures in PRODUCTS are per 100 residents.
export const TOWN_SIZE = 300;
export const NOISE_BP = 1000;                         // +-10% seeded noise a month per product
export const SETTING_MIN_BP = 2500, SETTING_MAX_BP = 40000;   // the world teacher's a and b multipliers per sector: 25% to 400%
export const REP_START_BP = 10000, REP_MIN_BP = 5000, REP_MAX_BP = 15000;
export const REP_STOCKOUT_BP = -300, REP_DELIVERED_BP = 100;  // a month with unmet NPC demand costs reputation; a month that delivered every order earns some

// The town's own shop (an NPC incumbent) for every product type: always open, never sold out, at 40% of the choke price (a little under the
// revenue-maximising half). Student companies compete against it, not just each other: price under it to win the town. ILLUSTRATIVE, tuned
// so a well-run company in a 300-student town earns each of 2 founders about 15-25% of the median net pay a month (docs/phase4.md "As built").
export const INCUMBENT_REF_BP = 4000;
// Storefront rent: every active company pays it from the treasury at each month start, before production, scaled by the price index.
// ILLUSTRATIVE ($50 a month for a stall in the Agora; config.options.ventures.rentCents overrides it). Unpaid two months in a row: frozen.
export const RENT_CENTS = 5000;
export const RENT_FREEZE_MONTHS = 2;
// Storefront spending caps per buyer per world month (bank transfers can be off for a class: a storefront must not become a way round them).
export const STORE_PER_COMPANY_CENTS = 10000, STORE_PER_MONTH_CENTS = 25000;
// A founder who has not paid in the minimum within this many world months of approval can be removed by the founders who have.
export const UNPAID_REMOVE_MONTHS = 2;

// ---- statements ----
// Public summary on the Venture Row board: a revenue band (last month), never the figure.
export const REVENUE_BANDS = [[0, 'No sales'], [50000, 'Under $500'], [200000, '$500 to $2,000'], [500000, '$2,000 to $5,000'], [Infinity, 'Over $5,000']];
export const bandOf = (cents) => (cents <= 0 ? REVENUE_BANDS[0][1] : REVENUE_BANDS.slice(1).find(([top]) => cents < top)[1]);
// The journal: each ledger kind this module posts, as the accounting entry it stands for (FIN1015).
export const JOURNAL = {
  'ventures.capital': { debit: 'Cash', credit: 'Share capital' },
  'ventures.production': { debit: 'Inventory', credit: 'Cash' },
  'ventures.npc_sale': { debit: 'Cash', credit: 'Sales revenue (town customers)' },
  'ventures.store_sale': { debit: 'Cash', credit: 'Sales revenue (classmates)' },
  'ventures.payout': { debit: 'Distributions to shareholders', credit: 'Cash' },
  'ventures.refund': { debit: 'Share capital (returned)', credit: 'Cash' },
  'ventures.rent': { debit: 'Rent expense', credit: 'Cash' },
};

// ======== wave 4b: payroll, small business tax, loans ========
// ---- payroll (the jobs module computes the T4127 stub and the employer's CPP and EI; ventures pays them from the treasury) ----
export const REP_MISSED_PAYROLL_BP = -500;   // each pay the treasury could not cover. ILLUSTRATIVE
export const MAX_POSTINGS = 3;               // open job postings per company
export const MAX_STAFF = 10;
export const MAX_WAGE_CENTS = 15000;        // review 6c-1: $150.00/h, 10 x the minimum, the ceiling for a posting (x the price index). ILLUSTRATIVE
export const MAX_SLOTS = 5;                 // 6c: places on one posting (1-5); it closes when they are filled
// ---- small business income tax ----
// 11% on net income at year end (the first tick of each world year), losses carried forward:
//   federal 9%: CRA, "Corporation tax rates": "For Canadian-controlled private corporations claiming the small business deduction, the net tax
//   rate is 9%" (https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/corporations/corporation-tax-rates.html, read 2026-10-23);
//   Alberta 2%: Alberta Treasury Board and Finance (Tax and Revenue Administration), small business rate on active business income up to the
//   $500,000 small business threshold (https://www.alberta.ca/corporate-income-tax states the threshold; the 2% rate is not on that page, so it is
//   ILLUSTRATIVE until read from TRA's CT-1). Every company here is a CCPC far below $500,000.
export const TAX_FEDERAL_BP = 900, TAX_ALBERTA_BP = 200, TAX_RATE_BP = TAX_FEDERAL_BP + TAX_ALBERTA_BP;
export const TAX_URL = 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/corporations/corporation-tax-rates.html';
// ---- GST (Alberta has no PST/HST: 5% GST) ----
// Small supplier: $30,000 of taxable supplies over the last four consecutive calendar quarters; past it, registration is mandatory "at the end of
// the month following the quarter" (CRA, "When to register for and start charging the GST/HST",
// https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/when-register-charge.html, read 2026-10-23).
// Here: checked at each world quarter's end over the last 12 world months; registered from the month after next (simplified: the single-quarter
// rule is folded into the four-quarter one). Voluntary registration starts next month.
export const GST_BP = 500, GST_THRESHOLD_CENTS = 3_000_000;
export const GST_URL = 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/when-register-charge.html';
// ---- the Venture Bank ----
export const LOAN_SPREAD_BP = 300;           // over the policy rate (options.ventures.loanSpreadBp; the world teacher can change it per world)
export const LOAN_MIN_CENTS = 10000, LOAN_NEW_CENTS = 500000;   // $100 minimum; a new company (fewer than 3 statements) may borrow $5,000
export const LOAN_REVENUE_X = 3;             // or up to 3 x its trailing 3-month average revenue
export const LOAN_MIN_TERM = 12, LOAN_MAX_TERM = 36;
export const LOAN_LATE_FEE_CENTS = 5000;     // $50 a missed payment, added to the loan. ILLUSTRATIVE
export const LOAN_DEFAULT_MISSES = 3;
export const REP_LATE_LOAN_BP = -300;        // ILLUSTRATIVE
// The journal for the 4b kinds (ventures.<kind> postings on the treasury).
Object.assign(JOURNAL, {
  'ventures.payroll': { debit: 'Wages + employer CPP and EI', credit: 'Cash' },
  'ventures.severance': { debit: 'Wages (pay in lieu of notice) + employer CPP and EI', credit: 'Cash' },
  'ventures.loan_in': { debit: 'Cash', credit: 'Loan payable (Venture Bank)' },
  'ventures.loan_payment': { debit: 'Loan payable + Interest expense', credit: 'Cash' },
  'ventures.loan_settle': { debit: 'Loan payable', credit: 'Cash' },
  'ventures.gst_collected': { debit: 'Cash', credit: 'GST payable' },
  'ventures.gst_paid': { debit: 'GST payable (input tax credit)', credit: 'Cash' },
  'ventures.gst_remit': { debit: 'GST payable', credit: 'Cash' },
  'ventures.gst_refund': { debit: 'Cash', credit: 'GST receivable' },
  'ventures.tax': { debit: 'Income tax payable', credit: 'Cash' },
});
