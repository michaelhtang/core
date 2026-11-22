// The example business for FinTech 10 section 6, FinTech Marketplace (plan days Dec 7 to Jan 13). Mr. Tang chose "a new product
// business" on 2026-11-11; this one is made up, and every figure in it is for him to confirm (REVIEW-ft10-s6-*.md). The class votes on
// its own business on Dec 15, so the lessons need an example from the first day. Every lesson, figure and test of the section READS its
// numbers from here; nobody retypes them. Amounts are integer cents. The file checks itself when it is imported.
//
// Scope. In: what a business is, target market, a competitor table, a quick survey, the 4 Ps, cost per unit, cost-plus and
// competitor-based pricing, product mix, the pitch, the six plan sections (named exactly as his plan names them), memo, e-mail and
// business letter, importing with the class exchange rate and an example tariff, start-up money, fixed and variable costs, break-even,
// two sales rounds, an income statement and a balance sheet from sales, comparing the rounds, risks.
// NOT in scope, and not to be taught or mentioned: GST or any sales tax, income tax, wages (the partners are not paid; they share the
// profit), interest (the loan has none), depreciation, any real exchange rate, any real tariff rate, any named trade agreement, any
// named country for the supplier, and how a sales round is run (the game's sales rounds are not built yet: the lessons only read the
// results).
// Words the road already uses are used the same way here: the class exchange rate US$1 = C$1.40 (ft10-s4-u2-l1), a tariff is a tax
// on goods that come in from another country (ft10-s4-u3-l2), inventory, cost of goods sold and gross profit (ft10-s5-u4-l2).

export const COMPANY = {
  name: 'North Star Pins',
  kind: 'a partnership of four students',
  what: 'Four Grade 10 students design enamel pins and sell them at their school’s winter market.',
  product: 'enamel pin',
  designs: ['Aurora', 'Bison'],                       // the product mix: two designs, same cost, same price
  market: 'the school winter market',
  partners: [                                         // first names only, made-up people; one role each (the org chart)
    { name: 'Amara', role: 'Team lead' },
    { name: 'Devon', role: 'Finance lead' },
    { name: 'Mei', role: 'Production lead' },
    { name: 'Tariq', role: 'Marketing lead' },
  ],
};

// The six sections of the business plan, in order, as Mr. Tang's plan names them (rows Dec 16 to Jan 13).
export const PLAN_SECTIONS = ['Business description and mission', 'Marketing plan', 'Production and operations', 'Financial plan', 'Forecast', 'Risks and conclusions'];

// One word per idea. Definitions the road already gave are repeated in the same words.
export const GLOSSARY = {
  'business': 'A person or group that sells a product or a service to earn a profit.',
  'product': 'A thing a business makes or buys to sell.',
  'service': 'Work a business does for a customer, such as a repair.',
  'profit': 'What is left when the costs are taken away from the sales. In the books it is called net income.',
  'partnership': 'A business owned by two or more people, called partners.',
  'target market': 'The group of people a business most wants to sell to.',
  'competitor': 'Another business that sells to the same customers.',
  'survey': 'A short set of questions asked to many people, to learn what they want.',
  'marketing mix': 'The four choices that shape how a product is sold: product, price, place and promotion. Also called the 4 Ps.',
  'promotion': 'How a business tells its target market about the product.',
  'cost per unit': 'What one item costs the business to get ready to sell.',
  'markup': 'The amount added to the cost per unit to make the price.',
  'product mix': 'The set of different products a business sells.',
  'pitch': 'A short talk that asks someone to back a business idea.',
  'business plan': 'A written plan that says what the business will sell, to whom, how, and with what money.',
  'mission': 'One sentence that says what the business is for.',
  'org chart': 'A drawing or list that shows who does which job in a business.',
  'memo': 'A short written message to people inside a business.',
  'business letter': 'A formal letter from a business to someone outside it.',
  'import': 'To buy goods from another country and bring them in.',
  'exchange rate': 'The price of one currency in another currency.',
  'tariff': 'A tax on goods that come in from another country.',
  'landed cost': 'The full cost of imported goods once they arrive: the goods, the tariff and the shipping.',
  'start-up money': 'The money a business needs before it can make its first sale.',
  'fixed cost': 'A cost that stays the same however many items are sold.',
  'variable cost': 'A cost that grows with each item sold.',
  'break-even point': 'The number of items a business must sell for its sales to cover all of its costs.',
  'inventory': 'Goods bought to be sold and not yet sold.',
  'cost of goods sold': 'What the goods that were sold cost the business.',
  'gross profit': 'Sales minus cost of goods sold.',
  'net income': 'Gross profit minus the other expenses, when what is left is above zero.',
  'forecast': 'A careful estimate of future sales and costs, made before they happen.',
  'risk': 'Something that could go wrong and cost the business money.',
};

// ---- market research ----
// The quick survey: 40 students asked "What is the most you would pay for a pin?". Each answer is the highest price that student accepts.
export const SURVEY = { asked: 40, wouldNotBuy: 16, most: [{ cents: 400, students: 6 }, { cents: 600, students: 12 }, { cents: 800, students: 6 }] };
// how many of the students surveyed would buy at a price: everyone whose highest price is that price or more
export const buyersAt = (cents) => SURVEY.most.filter((m) => m.cents >= cents).reduce((s, m) => s + m.students, 0);
// The competitor table (a competitive matrix): made-up competitors at the same market, and one online.
export const COMPETITORS = [
  { name: 'Sticker table', sells: 'vinyl stickers', cents: 300, strength: 'cheap', weakness: 'many tables sell stickers' },
  { name: 'Button stand', sells: 'pin-back buttons', cents: 200, strength: 'cheapest', weakness: 'plain designs' },
  { name: 'Online pin shop', sells: 'enamel pins', cents: 900, strength: 'many designs', weakness: 'costs more and takes two weeks to arrive' },
];

// ---- sourcing: the pins are imported; the backing cards are printed nearby ----
export const SUPPLY = {
  units: 200,                    // one order of pins, enough for both market days
  usdCentsPerPin: 150,           // the supplier's price: US$1.50 a pin
  cadCentsPerUsd: 140,           // the class exchange rate, US$1 = C$1.40 (ft10-s4-u2-l1: made up, only an example)
  tariffBp: 1000,                // an EXAMPLE tariff of 10% of the goods' value in Canadian dollars (not a real rate)
  shippingCents: 3800,           // shipping for the whole order, in Canadian dollars
  packagingCentsPerPin: 50,      // a backing card and a small bag for each pin
};
export const orderUsdCents = SUPPLY.units * SUPPLY.usdCentsPerPin;                          // US$300.00
export const orderCadCents = (orderUsdCents * SUPPLY.cadCentsPerUsd) / 100;                 // C$420.00
export const tariffCents = (orderCadCents * SUPPLY.tariffBp) / 10000;                       // $42.00
export const landedCents = orderCadCents + tariffCents + SUPPLY.shippingCents;              // $500.00
export const landedCentsPerPin = landedCents / SUPPLY.units;                                // $2.50
export const unitCostCents = landedCentsPerPin + SUPPLY.packagingCentsPerPin;               // $3.00: the cost per unit, and the variable cost
export const inventoryCostCents = unitCostCents * SUPPLY.units;                             // $600.00 for 200 pins ready to sell

// ---- price ----
export const PRICE = { round1: 600, round2: 500 };                                          // $6.00, then $5.00
export const markupCents = PRICE.round1 - unitCostCents;                                    // $3.00 on a $3.00 cost: a markup of 100% of cost

// ---- costs that do not depend on how many pins sell ----
export const FIXED = [
  { name: 'Market table, two days', cents: 6000 },                                          // $30.00 a day
  { name: 'Display board and signs', cents: 4500 },
  { name: 'Posters', cents: 3000 },
  { name: 'Sample pins', cents: 1500 },
];
export const fixedCents = FIXED.reduce((s, f) => s + f.cents, 0);                           // $150.00, the plan's fixed costs
export const EXTRA_PROMOTION_CENTS = 2000;                                                  // $20.00 more promotion, decided after round 1 (not in the plan)
// break-even in pins: fixed costs / (price - cost per unit). Throws unless it is a whole number of pins.
export function breakEven(priceCents, fixed = fixedCents) {
  const each = priceCents - unitCostCents;
  if (each <= 0 || fixed % each !== 0) throw new Error(`north-star-pins.js: break-even at ${priceCents} with ${fixed} fixed is not a whole number of pins`);
  return fixed / each;
}

// ---- start-up money (the plan calls it capitalization) ----
export const START = { partners: COMPANY.partners.length, eachCents: 15000, loanCents: 15000, lender: 'Amara’s aunt' };   // the loan has no interest and is repaid after the market
export const partnerCapitalCents = START.partners * START.eachCents;                        // $600.00
export const startUpCents = partnerCapitalCents + START.loanCents;                          // $750.00 = stock $600.00 + fixed costs $150.00

// ---- the forecast the group wrote before the first market day, and the two sales rounds ----
export const FORECAST = { round1Pins: 60 };                                                 // their own estimate; the first day beat it
export const ROUNDS = [
  { no: 1, day: 'the first market day', priceCents: PRICE.round1, pins: { Aurora: 45, Bison: 25 },
    expenses: [{ name: 'Market table', cents: 3000 }, { name: 'Display board and signs', cents: 4500 }, { name: 'Posters', cents: 3000 }, { name: 'Sample pins', cents: 1500 }] },
  { no: 2, day: 'the second market day', priceCents: PRICE.round2, pins: { Aurora: 60, Bison: 50 },
    expenses: [{ name: 'Market table', cents: 3000 }, { name: 'More posters', cents: EXTRA_PROMOTION_CENTS }] },
];
// one round's results: pins sold, sales, cost of goods sold, gross profit, expenses, net income
export function round(no) {
  const r = ROUNDS.find((x) => x.no === no); if (!r) throw new Error(`no round ${no}`);
  const pins = Object.values(r.pins).reduce((s, n) => s + n, 0), sales = pins * r.priceCents, cogs = pins * unitCostCents;
  const expenses = r.expenses.reduce((s, e) => s + e.cents, 0);
  return { ...r, pinsSold: pins, sales, cogs, grossProfit: sales - cogs, expensesTotal: expenses, netIncome: sales - cogs - expenses };
}
// both rounds added together
export function total() {
  const a = round(1), b = round(2);
  return { pinsSold: a.pinsSold + b.pinsSold, sales: a.sales + b.sales, cogs: a.cogs + b.cogs, grossProfit: a.grossProfit + b.grossProfit, expensesTotal: a.expensesTotal + b.expensesTotal, netIncome: a.netIncome + b.netIncome };
}
// The balance sheet at three moments: 0 = the day the money is collected, 1 = after round 1, 2 = after round 2.
// The pins are bought before round 1; each round's expenses are paid in that round. Equity is one line, Partners' Capital.
export function balanceSheet(after) {
  const done = ROUNDS.filter((r) => r.no <= after).map((r) => round(r.no));
  const pinsLeft = SUPPLY.units - done.reduce((s, r) => s + r.pinsSold, 0);
  const cash = startUpCents - (after >= 1 ? inventoryCostCents : 0) + done.reduce((s, r) => s + r.sales - r.expensesTotal, 0);
  const inventory = after >= 1 ? pinsLeft * unitCostCents : 0;
  const capital = partnerCapitalCents + done.reduce((s, r) => s + r.netIncome, 0);
  return { cash, inventory, assets: cash + inventory, loan: START.loanCents, capital, pinsLeft, balanced: cash + inventory === START.loanCents + capital };
}
export const shareEachCents = () => total().netIncome / START.partners;                     // the profit, shared equally
// whole dollars as $420, anything else as $2.50
export const money = (cents) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-CA')}` : `$${(cents / 100).toFixed(2)}`);

// ---- self-check, on import ----
(function check() {
  const fail = (m) => { throw new Error(`north-star-pins.js: ${m}`); };
  const whole = (n) => Number.isSafeInteger(n) && n >= 0;
  if (![orderUsdCents, orderCadCents, tariffCents, landedCents, landedCentsPerPin, unitCostCents, inventoryCostCents, fixedCents, startUpCents, markupCents].every(whole)) fail('a derived amount is not a whole number of cents');
  if (SURVEY.wouldNotBuy + SURVEY.most.reduce((s, m) => s + m.students, 0) !== SURVEY.asked) fail('the survey answers do not add up to the students asked');
  if (startUpCents !== inventoryCostCents + fixedCents) fail('the start-up money must equal the stock plus the planned fixed costs');
  if (fixedCents !== round(1).expensesTotal + round(2).expensesTotal - EXTRA_PROMOTION_CENTS) fail('the two rounds must spend exactly the planned fixed costs, plus the extra promotion');
  breakEven(PRICE.round1); breakEven(PRICE.round2, fixedCents + EXTRA_PROMOTION_CENTS);
  if (total().pinsSold > SUPPLY.units) fail('more pins sold than were ordered');
  for (const r of ROUNDS) if (Object.keys(r.pins).join() !== COMPANY.designs.join()) fail(`round ${r.no}: one count for each design, in order`);
  for (const after of [0, 1, 2]) { const b = balanceSheet(after); if (!b.balanced || b.cash < 0) fail(`the balance sheet after round ${after} does not balance, or the cash is below zero`); }
  if (total().netIncome % START.partners !== 0) fail('the profit does not split into equal whole cents');
  if (PLAN_SECTIONS.length !== 6 || COMPANY.partners.length !== 4) fail('six plan sections and four partners');
})();
