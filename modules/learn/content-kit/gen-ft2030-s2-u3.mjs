// Generator for ft2030-s2-u3 "From data to paperwork". Every number below is computed here from the case data, never typed into prose.
// Run from the repo root: node modules/learn/content-kit/gen-ft2030-s2-u3.mjs   (writes modules/learn/draft/ft2030-s2-u3.json)
import fs from 'node:fs';

const D = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const up = (a, b) => Math.ceil(a / b - 1e-9);
const pct = (a, b) => (a / b) * 100;
const ID = 'ft2030-s2-u3';

const T = (term, meaning) => ({ term, meaning });
const tbl = (title, columns, rows) => ({ kind: 'table', title, columns, rows });
const bars = (title, unit, items) => ({ kind: 'bars', title, unit, bars: items.map(([label, value]) => ({ label, value })) });
const card = (text, figure) => {
  if (text.length > 320) throw new Error(`card too long (${text.length}): ${text}`);
  return { text, ...(figure ? { figure } : {}) };
};

// the right option is placed by a spread that varies with the question; positions 0..n-1 all occur across a level
let spin = 0;
const choice = (label, prompt, right, wrongs, hint, extra = {}) => ({ _k: 'choice', label, prompt, right, wrongs, hint, ...extra });
const num = (label, prompt, o) => ({ _k: 'number', label, prompt, ...o });
const pt = (label, prompt, o) => ({ _k: 'point', label, prompt, ...o });
const build = (lvl, qs) => qs.map((x, i) => {
  const id = `${ID}-l${lvl}-q${i + 1}`;
  const { _k, right, wrongs, label, prompt, hint, figure, terms, ...rest } = x;
  const base = { id, label, prompt, type: _k, ...(figure ? { figure } : {}), ...(terms ? { terms } : {}), hint };
  if (_k === 'choice') {
    const options = wrongs.map(([text, why]) => ({ text, why }));
    const at = (spin++ * 3 + 1) % (options.length + 1);
    options.splice(at, 0, { text: right[0], why: right[1] });
    return { ...base, options, answer: at };
  }
  if (_k === 'point') return { ...base, answer: rest.answer, why: rest.why, miss: rest.miss };
  const { unit, answer, tol = 0, why, working, miss, traps } = rest;
  return { ...base, unit, answer, tolerance: tol, why, working, ...(traps ? { traps } : {}), miss };
});

// ---------- terms ----------
const SAMPLE = T('sample', 'The group of people who answered your survey.');
const BIAS = T('sampling bias', 'When the group that answered leans one way, so the result is not a fair picture of your real customers.');
const MARGIN = T('contribution margin', 'The price minus the variable cost of one item: what each sale puts toward the fixed costs.');
const BEP = T('break-even point', 'The number of items a business must sell for its sales to cover all of its costs.');
const LIAB = T('liability', 'Something you owe, or may have to pay back.');
const NET = T('net funds', 'Total raised minus total spent. Only this part goes to the cause.');
const DISB = T('disbursing funds', 'Paying out the money that was raised, to the person or group it was raised for.');

// =====================================================================================================
// LEVEL 1: Whose answers do you trust?
// =====================================================================================================
const TS = { inN: 25, inYes: 20, outN: 20, outYes: 8 }; // Twist Stop, card figure
const tsIn = pct(TS.inYes, TS.inN), tsOut = pct(TS.outYes, TS.outN), tsGap = tsIn - tsOut;
const PP = { n: 40, yes: 30 }; // Pixel Pins, q3
const CC = { inN: 50, inYes: 35, outN: 20, outYes: 5 }; // Chai Cart, q4 and q5
const ccIn = pct(CC.inYes, CC.inN), ccOut = pct(CC.outYes, CC.outN);
const L1BARS = [['Sock Swap', 70], ['Tea Cart', 45], ['Bead Kits', 30], ['Note Packs', 60]];
const L1IN = 85;

const l1cards = [
  card('A sample is the group of people who answered your survey. A team often ends up with two. The in-class sample is people who know the team. The outside sample is people who do not. The two samples can tell different stories.'),
  card('Sampling bias means the people who answered lean one way, so the result is not a fair picture of your real customers. Friends want to be nice, so they say yes and name a high price. Strangers have no reason to be kind.'),
  card(`Twist Stop sells cinnamon twists at ${D(400)}. Its survey asked: would you buy one at that price? The two samples gave very different answers.`,
    tbl('Twist Stop survey', ['Sample', 'Answers', 'Would buy', 'Share'], [
      ['In class', String(TS.inN), String(TS.inYes), `${tsIn}%`], ['Outside', String(TS.outN), String(TS.outYes), `${tsOut}%`]])),
  card(`When the samples disagree, plan with the outside number. It is closer to what real customers will do. A gap is counted in percentage points: ${tsIn}% down to ${tsOut}% is a drop of ${tsGap} points. A gap is not a failure. But three outside answers can swing on one person, so get enough.`),
  card('There are four honest options after a survey. Keep needs evidence, not just a lack of bad news.',
    tbl('Four options', ['Option', 'Use it when'], [
      ['Keep', 'The data supports the idea as written'], ['Reprice', 'Right product, wrong price'],
      ['Reposition', 'Right product, wrong customer or moment'], ['Replace', 'The data says no']])),
  card('A pivot changes one part of the concept: the product, the customer, the benefit or how they get it. A pretzel stand at lunch finds most students bring lunch. The same pretzels after practice reach hungry students at a new moment. Same product, different business.'),
];

const l1q = [
  choice('Outside sample', 'Dana\'s team handed its survey to 30 classmates and to 15 students it had never met. Which group is the outside sample?',
    ['The 15 students it had never met', 'These people do not know the team, so they are the outside sample.'],
    [['The 30 classmates', 'The classmates know the team. They are the in-class sample.'],
     ['All 45 people together', 'The outside sample is only the people outside the team\'s circle.'],
     ['The members of Dana\'s team', 'The team writes the survey. It is not a sample of customers.']],
    'Which group does not know the team?', { terms: [SAMPLE] }),
  choice('Kind answers', 'Why do answers from friends tend to be higher than answers from strangers?',
    ['Friends know the team and do not want to let it down', 'People who know you lean toward being kind. That is sampling bias.'],
    [['Friends always have more money', 'Money has nothing to do with it. Friends lean kind because they know the team.'],
     ['Friends read the question more carefully', 'Reading carefully does not change how kind someone feels.'],
     ['Friends are a bigger group', 'Size is not the reason. Friends lean kind even in a small group.']],
    'Think about how you answer a friend who asks, "Would you buy this?"', { terms: [BIAS] }),
  num('Share who buy', `Pixel Pins asked ${PP.n} classmates if they would buy a pin at the posted price. ${PP.yes} said yes. What percent said yes?`, {
    hint: 'Divide the number who said yes by the number asked.', unit: '%', answer: pct(PP.yes, PP.n), tol: 0,
    why: 'A share is the count who said yes divided by everyone who answered.', working: `${PP.yes} / ${PP.n} = ${PP.yes / PP.n} = ${pct(PP.yes, PP.n)}%.`,
    miss: 'Divide yes answers by all answers, then write it as a percent.',
    traps: [{ value: PP.n - PP.yes, why: 'That is the count who did not say yes. Divide yes by all answers.' }] }),
  num('The gap', `Chai Cart asked ${CC.inN} classmates: ${CC.inYes} would buy. It asked ${CC.outN} students it did not know: ${CC.outYes} would buy. By how many percentage points is the outside share lower than the in-class share?`, {
    hint: 'Work out both shares first, then subtract the smaller from the larger.', unit: '%', answer: ccIn - ccOut, tol: 0,
    terms: [T('percentage points', 'The difference between two percentages, such as 80% down to 40%.')],
    why: 'The gap is the in-class share minus the outside share.', working: `${CC.inYes} / ${CC.inN} = ${ccIn}%. ${CC.outYes} / ${CC.outN} = ${ccOut}%. ${ccIn} - ${ccOut} = ${ccIn - ccOut} points.`,
    miss: 'Find each share as a percent first. Then take the difference.',
    traps: [{ value: ccOut, why: 'That is the outside share itself. The question asks for the gap between the two shares.' }] }),
  choice('Which to plan with', 'Chai Cart\'s two samples were about the same size. Which number should it plan with?',
    ['The outside share, because strangers have no reason to be kind', 'Outside answers are closer to what real customers will do.'],
    [['The in-class share, because those people know the product', 'They know the team, which is what makes their answers kind.'],
     ['The average of the two, because it treats both fairly', 'An average keeps the kind answers in. The outside number is the safer one to plan with.'],
     ['The higher share, because it gives more room', 'The higher number is the kind one. Planning on it risks a plan with too few buyers.']],
    'Which group has no reason to be kind to the team?', { terms: [BIAS] }),
  choice('Name the option', 'A bike-light stand finds that students like the lights and would buy, but only at $5. It charges $9. Which option fits?',
    ['Reprice', 'It is the right product at the wrong price.'],
    [['Keep', 'Keep needs evidence that the idea works as written. The price does not match the data.'],
     ['Reposition', 'The customer and moment are fine here. The price is the problem.'],
     ['Replace', 'Students would buy, so the data does not say no.']],
    'What is wrong with the idea: the product, the customer or the price?'),
  choice('A reposition case', 'A hot-snack team sells at lunch. Its survey says most students bring lunch, but nearly everyone waiting for the late bus would buy. Which option fits?',
    ['Reposition', 'The product is fine. The team aimed at the wrong customer and moment, so it moves to the bus line.'],
    [['Reprice', 'Nothing in the survey says the price is the problem.'],
     ['Replace', 'Buyers exist, so the data does not say no.'],
     ['Keep', 'The data does not support selling at lunch as written.']],
    'Who is the customer the survey points to, and when are they there?'),
  choice('Enough to keep', 'Which is enough evidence to choose Keep?',
    ['Outside answers show buyers at a price above cost', 'This is evidence from strangers, at a price that works.'],
    [['Nobody told the team the idea was bad', 'A lack of bad news is not evidence.'],
     ['Most classmates said yes', 'Classmates know the team, so their yes is kind and weak evidence.'],
     ['The team likes the product', 'A liking is an opinion, not data from customers.']],
    'Keep needs evidence from outside the team\'s circle.'),
  pt('Biggest gap', `Every team's in-class share was ${L1IN}%. The bars show each team's outside share. Tap the team whose two samples disagree the most.`, {
    figure: bars('Outside share who would buy', '%', L1BARS), hint: 'The biggest gap sits where the outside share is furthest from the in-class share.',
    answer: L1BARS.reduce((b, x, i, a) => (x[1] < a[b][1] ? i : b), 0),
    why: `The outside share is lowest for ${L1BARS[2][0]}, so its gap from ${L1IN}% is biggest.`, miss: 'Compare each bar to the in-class share. Look for the one furthest below it.' }),
];

// =====================================================================================================
// LEVEL 2: A price in whole dollars
// =====================================================================================================
const SC = { price: 350, cost: 120, fixed: 8400, market: 120, lo: 300, hi: 400, shLo: 28, shHi: 12, asked: 40 }; // Sprout Cups
const scM = (p) => p - SC.cost;
const scBE = (p) => up(SC.fixed, scM(p));
const scBuy = (n) => (SC.market * n) / SC.asked;
const scLeft = (p, n) => scBuy(n) * scM(p) - SC.fixed;
const TOK = { out: 400, back: 310 };

const l2cards = [
  card(`Some markets take payment only in $1 tokens, so there is no change. Then every price is a whole number of dollars. A plan of ${D(250)} cannot be charged. The price becomes ${D(200).replace('.00', '')} or ${D(300).replace('.00', '')}.`),
  card(`A payment system is a set of rules that moves money from buyers to sellers. A market with $1 tokens runs a small one: the office issues tokens, sellers accept them, and hand them back for money. A token not handed back is a liability: the office still owes that value. $${TOK.out} out and $${TOK.back} back leaves $${TOK.out - TOK.back} out.`),
  card('Rounding is a real choice, and each way has a cost. Rounding down gives a lower margin per item but more buyers. Rounding up gives a higher margin but fewer buyers. Your survey tells you which way to go.',
    tbl('Rounding a price', ['Effect', 'Round down', 'Round up'], [
      ['Margin per item', 'Lower', 'Higher'], ['Likely buyers', 'More', 'Fewer'], ['Items to break even', 'More', 'Fewer']])),
  card(`Sprout Cups sells seedling cups. It planned ${D(SC.price)}, which the market cannot take. Fixed costs are ${D(SC.fixed)}. Each cup costs ${D(SC.cost)}. Break-even is fixed costs divided by margin, rounded up to a whole cup.`,
    tbl('Sprout Cups at two prices', ['Price', 'Margin', 'Cups to break even'], [SC.lo, SC.hi].map((p) => [D(p), D(scM(p)), String(scBE(p))]))),
  card(`Sprout Cups asked ${SC.asked} outside people if they would buy at each price. About ${SC.market} people pass the stand in a day. Buyers are the people who pass times the share who would buy.`,
    tbl('Outside survey', ['Price', 'Would buy', 'Share'], [[D(SC.lo), `${SC.shLo} of ${SC.asked}`, `${pct(SC.shLo, SC.asked)}%`], [D(SC.hi), `${SC.shHi} of ${SC.asked}`, `${pct(SC.shHi, SC.asked)}%`]])),
  card('Money left = buyers x margin - fixed costs. The survey, not a hunch, settles the price. Then check the break-even is still below your buyers.',
    tbl('Sprout Cups, money left', ['Price', 'Buyers', 'Money left'], [[SC.lo, SC.shLo], [SC.hi, SC.shHi]].map(([p, n]) => [D(p), String(scBuy(n)), D(scLeft(p, n))]))),
];

// questions
const Q1 = { plan: 425 };
const Q2 = { plan: 540, round: 500, cost: 210 };
const Q3 = { fixed: 12000, price: 500, cost: 210 };
const q3be = up(Q3.fixed, Q3.price - Q3.cost);
const Q5 = { price: 400, cost: 130, buyers: 50, fixed: 9600 };
const Q6 = { cost: 100, fixed: 6000, market: 100, lo: 200, hi: 300, shLo: 90, shHi: 60 };
const q6left = (p, s) => (Q6.market * s) / 100 * (p - Q6.cost) - Q6.fixed;
const Q7 = { issued: 520, back: 455 };
const Q9 = { cost: 140, fixed: 4000, rows: [[200, 85], [300, 55], [400, 25], [500, 10]] };
const q9tot = Q9.rows.map(([p, s]) => s * (p - Q9.cost));

const l2q = [
  choice('Whole dollars', `The market takes only whole-dollar payments. Dev planned to charge ${D(Q1.plan)}. Which two prices can Dev choose from?`,
    ['$4 or $5', 'The nearest whole dollars on each side of $4.25.'],
    [['$4.00 or $4.50', 'A half dollar is not a whole dollar. $4.50 cannot be paid with $1 tokens.'],
     ['$4.25 or $5.00', '$4.25 is the plan itself, and it is not a whole number.'],
     ['$3 or $4', '$3 is not next to $4.25. The nearest whole dollars are on each side of it.']],
    'Which two whole numbers sit on each side of 4.25?'),
  num('New margin', `Rosa planned ${D(Q2.plan)}. Her survey says to round down to the nearest whole dollar. Each item costs ${D(Q2.cost)}. What is her margin per item at the new price?`, {
    hint: 'First write the new price, then subtract the cost of one item.', unit: '$', answer: Q2.round - Q2.cost, tol: 0, terms: [MARGIN],
    why: 'Margin is the new price minus the cost of one item.', working: `Round down ${D(Q2.plan)} to ${D(Q2.round)}. ${D(Q2.round)} - ${D(Q2.cost)} = ${D(Q2.round - Q2.cost)}.`,
    miss: 'Round the price first, then take the cost of one item off it.',
    traps: [{ value: Q2.plan - Q2.cost, why: 'That uses the old price. The market cannot take it, so round first.' }] }),
  choice('Break-even items', `A team charges ${D(Q3.price)} for an item that costs ${D(Q3.cost)} to make. Its fixed costs are ${D(Q3.fixed)}. How many items must it sell to break even?`,
    [`${q3be} items`, 'Fixed costs divided by the margin, rounded up to a whole item.'],
    [[`${Math.floor(Q3.fixed / (Q3.price - Q3.cost))} items`, 'You cannot sell part of an item. At this number the team is still short, so round up.'],
     [`${up(Q3.fixed, Q3.price)} items`, 'That divides by the price. Divide by the margin, which is the price minus the cost.'],
     [`${up(Q3.fixed, Q3.cost)} items`, 'That divides by the cost of one item. Divide by the margin.']],
    'Margin first, then fixed costs divided by the margin.', { terms: [BEP] }),
  choice('Round up effect', `A team rounds its price up from ${D(250)} to ${D(300)}. What happens to its margin per item and to the items it needs for break-even?`,
    ['Higher margin, fewer items needed', 'A higher price leaves more on each sale, so fewer sales cover the fixed costs.'],
    [['Lower margin, fewer items needed', 'A higher price does not lower the margin.'],
     ['Higher margin, more items needed', 'A bigger margin means fewer items cover the fixed costs.'],
     ['Lower margin, more items needed', 'Rounding up raises the price, so the margin goes up.']],
    'Think about what a higher price leaves from each sale.'),
  num('Money left', `At ${D(Q5.price)} each, a team expects ${Q5.buyers} buyers. Each item costs ${D(Q5.cost)} and its fixed costs are ${D(Q5.fixed)}. How much money is left after fixed costs? Money left = buyers x margin - fixed costs.`, {
    hint: 'Find the margin, then multiply by the buyers, then take off the fixed costs.', unit: '$', answer: Q5.buyers * (Q5.price - Q5.cost) - Q5.fixed, tol: 0, terms: [MARGIN],
    why: 'The margin from all the buyers pays the fixed costs first. What remains is money left.', working: `Margin ${D(Q5.price)} - ${D(Q5.cost)} = ${D(Q5.price - Q5.cost)}. ${Q5.buyers} x ${D(Q5.price - Q5.cost)} = ${D(Q5.buyers * (Q5.price - Q5.cost))}. ${D(Q5.buyers * (Q5.price - Q5.cost))} - ${D(Q5.fixed)} = ${D(Q5.buyers * (Q5.price - Q5.cost) - Q5.fixed)}.`,
    miss: 'Do not forget to take off the fixed costs at the end.',
    traps: [{ value: Q5.buyers * (Q5.price - Q5.cost), why: 'That is the margin from all buyers. Subtract the fixed costs from it.' }] }),
  choice('Which way to round', `A team planned ${D(250)}. Each item costs ${D(Q6.cost)} and fixed costs are ${D(Q6.fixed)}. About ${Q6.market} people pass by. The outside survey shows the share who would buy at each price. The team picks the price that leaves more money after fixed costs. Which price?`,
    ['$3, because each sale leaves more and enough still buy', `At ${D(Q6.hi)}, ${Q6.shHi} buyers leave ${D(q6left(Q6.hi, Q6.shHi))}. At ${D(Q6.lo)}, ${Q6.shLo} buyers leave ${D(q6left(Q6.lo, Q6.shLo))}.`],
    [['$2, because more students would buy', `More buyers, but each sale leaves only ${D(Q6.lo - Q6.cost)}, so less money is left.`],
     ['$2, because it is the lower price', 'A lower price is not the test. The test is money left after fixed costs.'],
     ['Either one, because both sell more than break-even', 'Both clear break-even, but they leave different amounts. The prompt asks which leaves more.']],
    'Work out money left at each price with the survey shares.',
    { figure: tbl('Outside survey', ['Price', 'Share who would buy'], [[Q6.lo, Q6.shLo], [Q6.hi, Q6.shHi]].map(([p, s]) => [D(p), `${s}%`])), terms: [MARGIN] }),
  num('Tokens still out', `A market office issued ${Q7.issued} $1 tokens and sellers have handed back ${Q7.back} of them. How many dollars of tokens are still out?`, {
    hint: 'Subtract the tokens handed back from the tokens issued.', unit: '$', answer: (Q7.issued - Q7.back) * 100, tol: 0, terms: [LIAB],
    why: 'Tokens not handed back are still a liability of the office.', working: `${Q7.issued} - ${Q7.back} = ${Q7.issued - Q7.back} tokens, each worth $1.00, so ${D((Q7.issued - Q7.back) * 100)}.`,
    miss: 'Each token is worth $1. Count the tokens that have not come back.',
    traps: [{ value: Q7.back * 100, why: 'That is the amount handed back. The question asks for what is still out.' }] }),
  choice('A liability', 'The market office has sold $1 tokens and not all have come back. What does it mean that the unreturned tokens are a liability?',
    ['The office still owes that value to whoever hands them in', 'The office is holding the money and has not earned it yet.'],
    [['The office has already earned that money', 'It is not earned until the token comes back.'],
     ['The tokens are worth nothing now', 'A token still holds its value until it is handed back.'],
     ['The sellers owe the office that money', 'The office owes the value to the holder of the token.']],
    'Who has a claim on the money until a token comes back?', { terms: [LIAB] }),
  pt('Best price', `Each item costs ${D(Q9.cost)}. The bars show the share of 100 passers-by who would buy at each price. Tap the price that brings in the most margin in total. Fixed costs are the same at every price.`, {
    figure: bars('Share who would buy', '%', Q9.rows.map(([p, s]) => [D(p).replace('.00', ''), s])), hint: 'For each bar, multiply the share by the margin at that price.',
    answer: q9tot.indexOf(Math.max(...q9tot)), why: `Buyers times margin is highest at ${D(Q9.rows[q9tot.indexOf(Math.max(...q9tot))][0]).replace('.00', '')}.`,
    miss: 'Work out buyers x margin at every price, not only the cheapest or the dearest.' }),
];

// =====================================================================================================
// LEVEL 3: Where the money goes
// =====================================================================================================
const NETC = { raised: 30000, spent: 26000 };
const PK = { cups: 130, size: 50 };
const l3cards = [
  card('Money for a venture comes from different sources. Sales: what customers pay. Fundraising: money given for a purpose. Supplier credit: a supplier lets you take goods now and pay later. A grant: money from a society, a foundation or a government that is not paid back.'),
  card('The plan must say where the money goes. Name the recipient. "Charity" is a category. "The Elm Street Food Pantry" is a name. Add two sentences on why this cause. Then say how the money gets there: who holds it, who checks the total and how it is paid out. Keep it short.'),
  card(`Total raised is all the money collected. Total spent is all the costs. Net funds = raised - spent. Only the net goes to the cause. A stand that raises ${D(NETC.raised)} and spends ${D(NETC.spent)} sends ${D(NETC.raised - NETC.spent)}.`,
    tbl('A stand\'s funds', ['Line', 'Amount'], [['Total raised', D(NETC.raised)], ['Total spent', D(NETC.spent)], ['Net funds', D(NETC.raised - NETC.spent)]])),
  card('Every venture touches the school. Say the impact, then the fix. "Our line may block the hallway" is half an answer. Add "so we set up by the wall and keep a lane clear". Also say how people will hear about the purpose. A poster that names the cause makes the same product a different sale.'),
  card('Unsold items are money already spent. "We will figure it out" is not a plan. Real plans: sell the rest cheaper on the last day, give it away, take orders before you make, or make small batches and restock. Each one has a cost. Put it in the budget.'),
  card(`A purchase list is a shopping list someone else can buy from: exact item and size, packs, price per pack and where the price came from. You buy whole packs. Need ${PK.cups} cups in packs of ${PK.size}? Buy ${up(PK.cups, PK.size)} packs.`,
    tbl('A purchase list', ['Item', 'Packs', 'Per pack', 'Line cost'], [
      ['Paper cups, 250 mL, pack of 50', '3', D(600), D(1800)], ['Lids, pack of 100', '2', D(950), D(1900)]])),
];

const SA = { raised: 41000, spent: 33000 }, SB = { raised: 28000, spent: 30500 };
const netTotal = SA.raised + SB.raised - SA.spent - SB.spent;
const UN = { left: 40, normal: 400, sale: 300, cost: 150 };
const PN = { need: 340, size: 75, price: 420 };
const pnPacks = up(PN.need, PN.size);

const l3q = [
  choice('Source of money', 'Cedar Club takes its paper cups from a supplier now and pays for them in two weeks. Which source of money is that?',
    ['Supplier credit', 'The supplier lets the club take goods now and pay later.'],
    [['Fundraising', 'Fundraising is money given for a purpose. Here the supplier waits for payment.'],
     ['Sales', 'Sales are what customers pay. This is the supplier\'s arrangement.'],
     ['A grant', 'A grant is money that is not paid back. The club will pay the supplier.']],
    'Who is waiting to be paid?'),
  choice('A named use', 'Which line is the most specific use of funds?',
    ['The Elm Street Food Pantry\'s winter hat drive', 'It is a named recipient with a stated purpose that someone can check.'],
    [['Charity work in our city', 'That is a category. It does not name who gets the money.'],
     ['Helping people who need it', 'That is worthy but not specific. A named recipient can be checked.'],
     ['Good causes around the school', 'That is a category too. Name the recipient.']],
    'Which line names a recipient and a purpose?'),
  num('Net of two stands', `Two stands report their funds. What is the net funds of the two stands together?`, {
    figure: tbl('Two stands', ['Stand', 'Raised', 'Spent'], [['A', D(SA.raised), D(SA.spent)], ['B', D(SB.raised), D(SB.spent)]]),
    hint: 'Find each stand\'s net. One of them is negative.', unit: '$', answer: netTotal, tol: 0, terms: [NET],
    why: 'Stand B spent more than it raised, so it takes money away from the total.', working: `A: ${D(SA.raised)} - ${D(SA.spent)} = ${D(SA.raised - SA.spent)}. B: ${D(SB.raised)} - ${D(SB.spent)} = -${D(SB.spent - SB.raised)}. ${D(SA.raised - SA.spent)} - ${D(SB.spent - SB.raised)} = ${D(netTotal)}.`,
    miss: 'Net is raised minus spent for each stand. Then add the two nets.',
    traps: [{ value: SA.raised - SA.spent, why: 'That is only stand A. Stand B spent more than it raised, which lowers the total.' }, { value: SA.raised + SB.raised, why: 'That is the total raised. Take off the money spent.' }] }),
  choice('How funds move', 'Which sentence best answers "process for disbursing funds"?',
    ['The office holds the money. Two people count it. The office pays the club by cheque.', 'It says who holds the money, who checks and how it is paid.'],
    [['We will make sure the money gets there.', 'That is a promise, not a process. Say who holds it, who checks and how.'],
     ['The money goes to a very good cause.', 'That is about the cause. The question asks how the money gets there.']],
    'Look for who holds the money, who checks it and how it is paid.', { terms: [DISB] }),
  choice('Impact and fix', 'Which line names an impact on the school and a fix?',
    ['Our line may block the hallway, so we set up by the wall and keep a lane clear', 'It says what the problem is and what the team will do about it.'],
    [['Our line may block the hallway at 3:15', 'That is an impact with no fix.'],
     ['We will not affect the school at all', 'Every venture has some impact. Naming none looks like not having thought about it.'],
     ['Our stand will be very popular', 'That is about sales. It does not say how the school is affected.']],
    'Which line has both parts: the problem and what the team will do?'),
  choice('A real plan', 'Which unsold-items answer is a real plan with a cost?',
    ['Sell what is left cheaper on the last day, which lowers the margin on those items', 'It is a clear action, and it names its cost.'],
    [['We will figure it out when the day comes', 'That is not a plan.'],
     ['We hope that everything sells out on time', 'A hope is not a plan and it has no cost in the budget.'],
     ['There will not be any items left over', 'No one can be sure of that. A plan covers what happens if there is stock left.']],
    'Which answer says what the team will do and what it costs?'),
  num('Last-day discount', `On the last day a stand has ${UN.left} items left. They normally sell for ${D(UN.normal)} and cost ${D(UN.cost)} each. The team sells them for ${D(UN.sale)} each instead. If all ${UN.left} sell, how much margin does the team make on them?`, {
    hint: 'Margin is the price minus the cost of one item.', unit: '$', answer: UN.left * (UN.sale - UN.cost), tol: 0, terms: [MARGIN],
    why: 'The discount price still beats the cost, so each sale leaves a smaller margin, not a loss.', working: `${D(UN.sale)} - ${D(UN.cost)} = ${D(UN.sale - UN.cost)}. ${UN.left} x ${D(UN.sale - UN.cost)} = ${D(UN.left * (UN.sale - UN.cost))}.`,
    miss: 'Use the discount price, not the normal price, and take off the cost of one item.',
    traps: [{ value: UN.left * UN.sale, why: 'That is the money taken in. Take off the cost of each item to find the margin.' }] }),
  num('Cost of packs', `A team needs ${PN.need} napkins. They come in packs of ${PN.size} at ${D(PN.price)} a pack. It buys whole packs only. How much does it pay?`, {
    hint: 'How many whole packs cover the napkins you need? Then multiply by the price of a pack.', unit: '$', answer: pnPacks * PN.price, tol: 0,
    why: 'You pay for whole packs, not for the portion you need.', working: `${PN.need} / ${PN.size} = ${(PN.need / PN.size).toFixed(2)}, so ${pnPacks} packs. ${pnPacks} x ${D(PN.price)} = ${D(pnPacks * PN.price)}.`,
    miss: 'Count whole packs first. You cannot buy part of one.',
    traps: [{ value: Math.round((PN.need / PN.size) * PN.price), why: 'That prices only the part of a pack you need. You pay for the whole pack.' }, { value: (pnPacks - 1) * PN.price, why: 'That is one pack too few to cover the napkins.' }] }),
  choice('A shopping line', 'Which purchase line could someone who has never met the team buy from?',
    ['Paper plates, 23 cm, pack of 25, 4 packs', 'It names the item, the size, the pack and how many.'],
    [['Plates for the stand', 'It does not give a size or a number of packs.'],
     ['Enough paper goods', 'That is a guess. Nobody could buy from it.'],
     ['Party supplies, about $20', 'That is a budget, not a shopping list. Name the item and the pack.']],
    'Could you walk into a store with this line and buy the exact thing?'),
];

// =====================================================================================================
const lv = (n, title, learn, cards, qs) => ({ id: `${ID}-l${n}`, title, kind: 'lesson', learn, cards, questions: build(n, qs) });
const unit = {
  id: ID,
  title: 'From data to paperwork',
  blurb: 'Which survey answers to trust, a price in whole dollars, and where the money goes.',
  outcome_codes: ['ENT2020 2.5', 'ENT2020 3.1', 'ENT2020 3.3'],
  levels: [
    lv(1, 'Whose answers do you trust?', ['Say why strangers\' answers can be trusted more than friends\'.', 'Pick keep, reprice, reposition or replace using a number.'], l1cards, l1q),
    lv(2, 'A price in whole dollars', ['Round a price up or down and see what it does to break-even.', 'Use survey shares to choose the price that leaves more money.'], l2cards, l2q),
    lv(3, 'Where the money goes', ['Name where the money goes and work out the net.', 'Write a plan for unsold items and a list someone can shop from.'], l3cards, l3q),
  ],
};
fs.writeFileSync(new URL('../draft/ft2030-s2-u3.json', import.meta.url), `${JSON.stringify(unit, null, 2)}\n`);
console.log('wrote draft', unit.levels.map((l) => `${l.cards.length}c/${l.questions.length}q`).join(' '));
