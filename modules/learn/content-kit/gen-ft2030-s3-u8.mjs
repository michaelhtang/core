// Generator for the Learning Road unit ft2030-s3-u8 "A plan for a lifetime".
// Every number is computed here (and recomputed by a different method in test/learn-content-ft2030-s3-u8.test.js).
// Run: node modules/learn/content-kit/gen-ft2030-s3-u8.mjs   (writes modules/learn/draft/ft2030-s3-u8.json)
import fs from 'node:fs';

const U = 'ft2030-s3-u8';
const d = Math.round;
const cents = (x) => d(x * 100);
const usd = (x, dp = 2) => `$${x.toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const pct = (x) => `${x}%`;

// ---- the money formulas (closed forms; the test uses loops) ----
const pmtLoan = (P, annual, n) => { const r = annual / 12; return (P * r) / (1 - (1 + r) ** -n); };       // payment at the end of each month that clears a loan
const pmtGoal = (G, annual, n) => { const r = annual / 12; return (G * r) / ((1 + r) ** n - 1); };      // deposit at the end of each month that reaches a goal
const fvDeposits = (dep, annual, n) => { const r = annual / 12; return (dep * ((1 + r) ** n - 1)) / r; };
const grow = (p, rate, years) => p * (1 + rate) ** years;
const c2 = (x) => d(x * 100) / 100;   // to the cent

// ---- builders ----
const T = (term, meaning) => ({ term, meaning });
const tbl = (title, columns, rows) => ({ kind: 'table', title, columns, rows });
const barsFig = (title, unit, items) => ({ kind: 'bars', title, unit, bars: items.map(([label, value]) => ({ label, value })) });
// right option goes at position `pos` (0-based); the other options keep their order
const choice = (id, label, prompt, right, wrongs, pos, hint, terms) => {
  const options = wrongs.map(([text, why]) => ({ text, why }));
  options.splice(pos, 0, { text: right[0], why: right[1] });
  return { id, label, prompt, type: 'choice', ...(terms ? { terms } : {}), hint, options, answer: pos };
};
const num = (id, label, prompt, { unit, answer, tol = 0, why, working, hint, miss, traps, terms }) =>
  ({ id, label, prompt, type: 'number', ...(terms ? { terms } : {}), hint, unit, answer, tolerance: tol, why, working, miss, ...(traps ? { traps } : {}) });
const point = (id, label, prompt, figure, answer, why, hint, miss, terms) =>
  ({ id, label, prompt, type: 'point', ...(terms ? { terms } : {}), figure, hint, answer, why, miss });

const TERMS = {
  cashEq: T('cash equivalent', 'A very safe, short-term place that turns into cash fast, such as a savings account.'),
  efund: T('emergency fund', 'Savings kept for a job loss, a repair or a bill nobody planned.'),
  tolerance: T('risk tolerance', 'How big a fall in value a person can live with without being forced to sell or choosing to sell in a panic.'),
  pmt: T('payment function', 'A spreadsheet tool that finds the regular payment from a rate for one period, a number of periods and an amount.'),
  rrsp: T('RRSP', 'A registered account for saving toward retirement. Money put in is a deduction, and money taken out is taxed as income.'),
  room: T('RRSP room', 'How much you may put into an RRSP this year and deduct.'),
  deduction: T('deduction', 'An amount you may subtract from income before tax is worked out.'),
  dividend: T('dividend', 'A share of a company’s profit paid out to its owners.'),
  gain: T('capital gain', 'The amount you sell something for, minus what you paid for it, when the price is higher.'),
  shelter: T('tax shelter', 'A way of holding an investment so that tax is put off or removed.'),
  rule72: T('Rule of 72', 'A quick estimate: years to double is about 72 divided by the yearly rate in percent.'),
  sniff: T('sniff test', 'A quick check of whether a number looks sensible before you use it.'),
};

const levels = [];

// =====================================================================================================
// LEVEL 1  Two goals, two plans
// =====================================================================================================
{
  const NIA_FUND = 9600, NIA_EXP = 2400, NIA_PORT = 120000, CRASH = 0.15;                 // Lesson 35 line 255 and 237 (class example)
  const nia = { months: NIA_FUND / NIA_EXP, loss: NIA_PORT * CRASH };                         // 4.0 months, $18,000
  const STAGES = [['Early years', 80], ['Middle years', 60], ['Late years', 30]];            // Lesson 35 line 286 and 571 (equities 80, 60, 30)
  const cards = [
    { text: 'A plan starts with a goal and a date. A short-term goal is under 5 years away, such as a used car in 3 years. A long-term goal is 20 years or more away, such as retirement. One person can have both, and two different dates call for two different plans.' },
    { text: 'Money for a short-term goal has little time to wait out a fall in value. It goes in a cash equivalent: a very safe place that turns into cash fast, such as a savings account. It grows slowly, but the amount you saved is still there on the day you need it.' },
    { text: 'Money for a long-term goal has time. Equities can fall, but a person decades from the goal has years to wait for the repair. So the long-term plan can lean toward equities. A good plan says in advance what to do when a fall comes, instead of deciding in a panic.' },
    { text: `Before either goal comes an emergency fund: savings for a job loss, a repair or a bill nobody planned. A common target is 3 to 6 months of expenses. Months covered = fund / monthly expenses. Nia spends ${usd(NIA_EXP)} a month and has ${usd(NIA_FUND)} saved: ${NIA_FUND.toLocaleString('en-CA')} / ${NIA_EXP.toLocaleString('en-CA')} = ${nia.months.toFixed(1)} months.` },
    { text: `Why first? Say Nia’s investments are worth ${usd(NIA_PORT)} and a crash takes ${CRASH * 100}% off. That is a paper loss of ${usd(nia.loss)}. If she then loses her job, her fund pays the bills, and she does not have to sell investments while prices are down. Without the fund, a loss on paper could become a real one.` },
    { text: 'A plan also changes over a lifetime. As a goal gets closer there is less time to repair a fall, so a plan can lower its equities. Here is one made-up plan. Re-check your risk tolerance whenever life changes, such as a new job, a new home or a big expense.',
      figure: tbl('One made-up plan by stage', ['Stage', 'In equities'], STAGES.map(([s, e]) => [s, pct(e)])) },
  ];

  // q3: six months of expenses
  const q3Exp = 2375;
  // q4: months covered
  const q4 = { exp: 2000, fund: 9000 };
  // q6: paper loss
  const q6 = { port: 84000, rate: 0.15 };
  // q7: four friends
  const friends = [['Bo', 2500, 10000], ['Eve', 1500, 9000], ['Di', 1000, 8000], ['Max', 2000, 7000]];
  const months = friends.map(([, e, f]) => f / e);
  const best = months.indexOf(Math.max(...months));
  // q9: late stage
  const q9 = { sum: 90000, eq: 0.30 };

  const questions = [
    choice(`${U}-l1-q1`, 'Short or long', 'Mira needs money for a trip in 2 years. Her other goal is retirement, 38 years away. Which pairing is right?',
      ['The trip is short-term and retirement is long-term', 'The trip is under 5 years away, and retirement is 20 years or more away.'],
      [['Both are long-term goals, because both need saving', 'A long-term goal is 20 years or more away. The trip is only 2 years away.'],
       ['The trip is long-term and retirement is short-term', 'That swaps them. A short-term goal is under 5 years away.']],
      0, 'Compare each date with 5 years and with 20 years.'),
    choice(`${U}-l1-q2`, 'Trip money', 'Following the plan on the cards, where does the money for Mira’s trip in 2 years belong?',
      ['In a cash equivalent such as a savings account', 'Money needed soon cannot wait out a fall, so it goes somewhere very safe that turns into cash fast.'],
      [['In mostly equities, so it grows as much as possible', 'Equities can fall, and 2 years is not enough time to wait for the repair.'],
       ['In the same long-term mix as retirement, to keep it simple', 'The trip is 2 years away and retirement is 38. Different dates need different plans.']],
      1, 'Ask how long the money can wait if the market falls.', [TERMS.cashEq]),
    num(`${U}-l1-q3`, 'Six-month target', `Hal spends ${usd(q3Exp)} a month. How many dollars is 6 months of his expenses?`,
      { unit: '$', answer: cents(q3Exp * 6), tol: 0, terms: [TERMS.efund], hint: 'Multiply one month of expenses by the number of months.',
        why: 'The target is counted in months of expenses, so multiply one month by 6.', working: `${usd(q3Exp)} x 6 = ${usd(q3Exp * 6)}.`,
        miss: 'Take one month of expenses and multiply it by 6.',
        traps: [{ value: cents(q3Exp * 3), why: `That is 3 months. The question asks for 6.` }, { value: cents(q3Exp + 6), why: 'That adds 6 dollars. Multiply by 6 instead.' }] }),
    choice(`${U}-l1-q4`, 'Months covered', `Kit spends ${usd(q4.exp)} a month and has ${usd(q4.fund)} in an emergency fund. How many months does the fund cover?`,
      [`${q4.fund / q4.exp} months`, `${q4.fund.toLocaleString('en-CA')} / ${q4.exp.toLocaleString('en-CA')} = ${q4.fund / q4.exp}. Months covered is the fund divided by one month of expenses.`],
      [[`${c2(q4.exp / q4.fund)} months`, 'That divides the other way, expenses by fund. Divide the fund by the expenses.'],
       ['3 months', 'That is the low end of the usual target, not what this fund covers.']],
      2, 'Divide the fund by one month of expenses.', [TERMS.efund]),
    choice(`${U}-l1-q5`, 'What the fund changes', 'A crash cuts the value of Nell’s investments, and the same month her hours are cut. She has an emergency fund. What does the fund let her do?',
      ['Pay bills from it and leave her investments alone while prices are down', 'Yes. She does not have to sell at the low prices, so the loss stays on paper.'],
      [['Stop her investments from falling in value', 'The crash still happens. The fund changes what she has to do about it, not the prices.'],
       ['Sell her investments quickly before they fall more', 'That is the panic move the fund helps her avoid. It turns a paper loss into a real one.']],
      1, 'Think about what she would have to sell without the fund.', [TERMS.efund]),
    num(`${U}-l1-q6`, 'Paper loss', `Gil’s investments are worth ${usd(q6.port)}. A crash takes ${q6.rate * 100}% off. How many dollars is the paper loss?`,
      { unit: '$', answer: cents(q6.port * q6.rate), tol: 0, hint: 'Find 15% of the value: multiply by 0.15.',
        why: 'A percent loss is that percent of the value before the fall.', working: `${usd(q6.port)} x 0.15 = ${usd(q6.port * q6.rate)}.`,
        miss: 'Multiply the value before the crash by 0.15. The result is the amount lost.',
        traps: [{ value: cents(q6.port * (1 - q6.rate)), why: 'That is what is left after the crash, not the loss.' }] }),
    point(`${U}-l1-q7`, 'Most months covered', `Four friends spend a different amount each month: Eve ${usd(1500)}, Bo ${usd(2500)}, Max ${usd(2000)} and Di ${usd(1000)}. Each bar is that friend’s emergency fund. Tap the friend whose fund covers the most months.`,
      barsFig('Emergency funds', '$', friends.map(([n, , f]) => [n, f * 100])), best,
      `Months covered is fund / expenses. Di has ${friends[best][2].toLocaleString('en-CA')} / ${friends[best][1].toLocaleString('en-CA')} = ${months[best]} months. Bo has the biggest fund, but also the biggest bills.`,
      'Divide each friend’s fund by that friend’s monthly expenses.', 'Work out fund / expenses for each friend. The biggest bar is not always the most months.', [TERMS.efund]),
    choice(`${U}-l1-q8`, 'When life changes', 'Abe’s plan worked for years. This year Abe starts a new job and takes on a large expense. What do the cards say about his risk tolerance?',
      ['Re-check it, because his time and needs may have changed', 'Risk tolerance belongs to the person and can change as life changes, so it is worth re-checking.'],
      [['Keep it, since a plan once made never needs a second look', 'The cards say to re-check it when life changes. A plan is not set once for good.'],
       ['Raise it, because a new job always means more risk is fine', 'Nothing says it goes up. It may go down. It has to be re-checked, not guessed.']],
      0, 'Look at the last card.', [TERMS.tolerance]),
    num(`${U}-l1-q9`, 'Late-stage mix', `In the made-up plan, the late years hold ${q9.eq * 100}% in equities. On ${usd(q9.sum)}, how many dollars are not in equities?`,
      { unit: '$', answer: cents(q9.sum * (1 - q9.eq)), tol: 0, hint: 'The rest of the money is 100% minus the share in equities.',
        why: 'What is not in equities is the rest: 100% minus 30%, which is 70%.', working: `100% - 30% = 70%. ${usd(q9.sum)} x 0.70 = ${usd(q9.sum * 0.7)}.`,
        miss: 'First find the share that is not in equities, then take that share of the money.',
        traps: [{ value: cents(q9.sum * q9.eq), why: 'That is the part in equities. The question asks for the rest.' }] }),
  ];
  levels.push({ title: 'Two goals, two plans', learn: ['Match a short-term goal and a long-term goal to different kinds of savings.', 'Work out how many months an emergency fund covers and say what it changes in a crash.'], cards, questions });
}

// =====================================================================================================
// LEVEL 2  The payment that gets you there
// =====================================================================================================
{
  const L = { P: 20000, rate: 0.06, n10: 120, n5: 60 };                                       // Lesson 21 slide 8 (class example)
  const pay10 = c2(pmtLoan(L.P, L.rate, L.n10)), pay5 = c2(pmtLoan(L.P, L.rate, L.n5));
  const total10 = pay10 * L.n10;
  const G = 6000, sv = 0.03;
  const g3 = c2(pmtGoal(G, sv, 36));
  const goalRows = [2, 3, 5].map((y) => { const p = c2(pmtGoal(G, sv, 12 * y)); return [y, p, p * 12 * y, G - p * 12 * y]; });
  const cards = [
    { text: 'A regular payment is the same amount every month, and it can do one of two jobs. It can pay off a loan: you borrow now and pay it back in equal parts. Or it can build a goal: you set aside the same amount each month until you reach a target. A spreadsheet has a payment function that finds it.' },
    { text: `The payment function needs three things: the rate for one period, the number of periods and the amount. Class example: ${usd(L.P)} borrowed at 6% a year, paid monthly for 10 years. The monthly rate is 6% / 12 = 0.5% and there are 120 months. The payment is ${usd(pay10)}. Over 5 years, it jumps.`,
      figure: tbl('A $20,000.00 loan at 6% a year', ['Time', 'Months', 'Payment'], [['10 years', String(L.n10), usd(pay10)], ['5 years', String(L.n5), usd(pay5)]]) },
    { text: `Add up what is paid: ${usd(pay10)} x ${L.n10} is about ${usd(d(total10), 0)}. The borrower got ${usd(L.P, 0)}, so about ${usd(d(total10) - L.P, 0)} is interest, the cost of borrowing. It is the same compound growth that builds savings, now working against the borrower.` },
    { text: `By hand, a loan payment is amount x r / (1 - (1 + r)^-n). Here r is the rate for one month and n the number of months. For the class loan, r = 0.005 and n = ${L.n10}: ${L.P.toLocaleString('en-CA')} x 0.005 / (1 - 1.005^-${L.n10}) = ${usd(pay10)}. A negative power means 1 divided by that power.` },
    { text: `Saving toward a goal turns it around. With a deposit at the end of each month, deposit = goal x r / ((1 + r)^n - 1). In this example a savings account pays 3% a year, so r = 0.25% a month. To have ${usd(G)} in 3 years (n = 36), the deposit is ${usd(g3)} a month.` },
    { text: 'Time changes the payment. For the same goal at the same rate, a longer wait means a smaller deposit, and more of the goal comes from interest. Here are three waits for the same $6,000.00 goal at the same 3%. The amounts paid in are the deposit times the months.',
      figure: tbl('A $6,000.00 goal at 3% a year', ['Years', 'Deposit a month', 'Paid in', 'Interest'], goalRows.map(([y, p, paid, int]) => [String(y), usd(p), usd(d(paid * 100) / 100), usd(d(int * 100) / 100)])) },
  ];

  const a3 = { P: 12000, rate: 0.06, n: 60 };
  const a4 = { G: 9000, rate: 0.03, n: 48 };
  const toni = 200, bars = [2, 3, 4, 5].map((y) => [y, pmtGoal(10000, sv, 12 * y)]);
  const toniAns = bars.findIndex(([, p]) => p <= toni);
  const a7 = { P: 10000, rate: 0.06, n: 36 };
  const pay7 = c2(pmtLoan(a7.P, a7.rate, a7.n));
  const a9 = { dep: 250, rate: 0.03, n: 36 };
  const bal9 = c2(fvDeposits(a9.dep, a9.rate, a9.n));

  const questions = [
    choice(`${U}-l2-q1`, 'Who earns interest', 'Interest shows up in both jobs of a regular payment. Who earns it on a loan, and who earns it on a savings goal?',
      ['On a loan the lender earns it. On savings you earn it', 'A borrower pays interest as the cost of borrowing. A saver is paid interest on the money in the account.'],
      [['On a loan you earn it. On savings the bank earns it', 'That is reversed. The borrower pays and the saver is paid.'],
       ['You earn it both times, as the person making the payments', 'A borrower pays interest, so it is not earned on a loan.']],
      0, 'Look at the card on the cost of borrowing.'),
    num(`${U}-l2-q2`, 'Monthly rate', 'A savings account pays 4.8% a year in this example, and deposits go in monthly. What monthly rate, in percent, goes into the payment formula?',
      { unit: '%', answer: c2(4.8 / 12 * 10) / 10, tol: 0, hint: 'The formula uses the rate for one month. How many months are in a year?',
        why: 'The formula works one month at a time, so the yearly rate is split over 12 months.', working: '4.8% / 12 = 0.4% a month.',
        miss: 'Divide the yearly rate by the number of months in a year.', traps: [{ value: 4.8 * 12, why: 'That multiplies. A month is a twelfth of a year, so divide.' }] }),
    num(`${U}-l2-q3`, 'Loan payment', `Jun borrows ${usd(a3.P)} at 6% a year, paid monthly over 5 years (${a3.n} months, monthly rate 0.5%). What is her monthly payment, to the nearest cent?`,
      { unit: '$', answer: cents(pmtLoan(a3.P, a3.rate, a3.n)), tol: 2, terms: [TERMS.pmt], hint: 'Use amount x r / (1 - (1 + r)^-n). Work out 1.005^-60 first.',
        why: 'The payment covers the loan and its interest, so it is more than the loan divided by 60.', working: `${a3.P.toLocaleString('en-CA')} x 0.005 / (1 - 1.005^-60) = ${usd(c2(pmtLoan(a3.P, a3.rate, a3.n)))}.`,
        miss: 'Use r = 0.005 and n = 60 in the loan formula. Keep the minus sign on the power.',
        traps: [{ value: cents(a3.P / a3.n), why: 'That is the loan divided by 60. It leaves out the interest.' }] }),
    num(`${U}-l2-q4`, 'Goal deposit', `Ezra wants ${usd(a4.G)} in 4 years from an account paying 3% a year (monthly rate 0.25%, ${a4.n} months). Deposits go in at the end of each month. What monthly deposit does he need, to the nearest cent?`,
      { unit: '$', answer: cents(pmtGoal(a4.G, a4.rate, a4.n)), tol: 2, terms: [TERMS.pmt], hint: 'Use goal x r / ((1 + r)^n - 1). Work out 1.0025^48 first.',
        why: 'Interest does part of the work, so the deposit is less than the goal divided by the number of months.', working: `${a4.G.toLocaleString('en-CA')} x 0.0025 / (1.0025^48 - 1) = ${usd(c2(pmtGoal(a4.G, a4.rate, a4.n)))}.`,
        miss: 'Use r = 0.0025 and n = 48 in the goal formula. The power gets 1 taken away, not 1 added.',
        traps: [{ value: cents(a4.G / a4.n), why: 'That splits the goal over 48 months and ignores interest. The deposit needed is smaller.' }] }),
    choice(`${U}-l2-q5`, 'Longer or shorter', 'Two plans reach the same goal at the same rate. Plan A takes 3 years and Plan B takes 6 years. Which has the smaller monthly deposit, and why?',
      ['Plan B, because there are more months and interest does more of the work', 'More months share the goal among more deposits, and interest has longer to add to it.'],
      [['Plan A, because fewer months means less to pay', 'Fewer months means each deposit has to be bigger to reach the same goal.'],
       ['They are the same, because the goal is the same', 'The goal is the same, but the deposits are not. Time changes the payment.']],
      2, 'Look at the table of three waits.'),
    point(`${U}-l2-q6`, 'Shortest she can afford', `Each bar is the monthly deposit needed to reach ${usd(10000)} in an account paying 3% a year, over 2, 3, 4 or 5 years. Toni can set aside ${usd(toni)} a month. Tap the shortest plan she can afford.`,
      barsFig('Monthly deposit for $10,000.00', '$', bars.map(([y, p]) => [`${y} years`, cents(p)])), toniAns,
      `The ${bars[toniAns][0]}-year plan needs ${usd(c2(bars[toniAns][1]))}, which fits in ${usd(toni)}. The shorter plan needs ${usd(c2(bars[toniAns - 1][1]))}, which is too much.`,
      'Find the first bar that is no more than $200.00, starting from the shortest plan.', 'The shortest plans need more than $200.00 a month. Find the first bar that fits.'),
    num(`${U}-l2-q7`, 'Cost of a loan', `Bao’s loan is ${usd(a7.P)} at 6% a year over 3 years. The payment is ${usd(pay7)} a month for ${a7.n} months. How many dollars of interest does Bao pay in all?`,
      { unit: '$', answer: cents(pay7 * a7.n - a7.P), tol: 0, hint: 'Total paid is the payment times the months. Interest is what is above the loan.',
        why: 'Interest is everything paid beyond the amount borrowed.', working: `${usd(pay7)} x ${a7.n} = ${usd(c2(pay7 * a7.n))}. ${usd(c2(pay7 * a7.n))} - ${usd(a7.P)} = ${usd(c2(pay7 * a7.n - a7.P))}.`,
        miss: 'Multiply the payment by the number of months, then take off the amount borrowed.',
        traps: [{ value: cents(pay7 * a7.n), why: 'That is the total paid, which includes the $10,000.00 borrowed. Take the loan off to get the interest.' }] }),
    choice(`${U}-l2-q8`, 'A deposit too big', 'A goal deposit comes out bigger than Zed can afford each month. The rate cannot change. Which change makes the deposit smaller?',
      ['Give the goal more months', 'More months spread the goal over more deposits, and interest has longer to help.'],
      [['Make the goal amount larger', 'A larger goal needs larger deposits.'],
       ['Cut the number of months', 'Fewer months mean bigger deposits, not smaller ones.']],
      1, 'Remember what the table of three waits showed.'),
    num(`${U}-l2-q9`, 'Interest earned', `Lou puts ${usd(a9.dep)} a month into an account paying 3% a year for ${a9.n} months. The balance at the end is ${usd(bal9)}. How many dollars of that balance came from interest?`,
      { unit: '$', answer: cents(c2(bal9 - a9.dep * a9.n)), tol: 0, hint: 'Total deposits is the deposit times the months.',
        why: 'The balance is the deposits plus the interest, so interest is the balance minus the deposits.', working: `${usd(a9.dep)} x ${a9.n} = ${usd(a9.dep * a9.n)}. ${usd(bal9)} - ${usd(a9.dep * a9.n)} = ${usd(c2(bal9 - a9.dep * a9.n))}.`,
        miss: 'Work out how much Lou put in altogether, then take that from the balance.',
        traps: [{ value: cents(a9.dep * a9.n), why: 'That is what Lou deposited. Interest is the balance minus that.' }] }),
  ];
  levels.push({ title: 'The payment that gets you there', learn: ['Say what a regular payment is for, whether it pays off a loan or builds a goal.', 'Work out a payment with the formula and see how the time you allow changes it.'], cards, questions });
}

// =====================================================================================================
// LEVEL 3  Registered accounts and tax
// =====================================================================================================
{
  const EX = 60000;                                                                           // Lesson 27 line 141 and Lesson 35 line 295 (class example)
  const room = EX * 0.18;
  const ded = { inc: 48000, put: 5000 };
  const cards = [
    { text: 'A registered account is an account set up under government rules, and it can hold investments. The account is the box and the investment is what is inside. A GIC is an investment. An RRSP is an account, so a GIC can sit in one. An RRSP is for saving toward retirement.' },
    { text: `Your RRSP room is how much you may put in this year and deduct. It is 18% of last year’s earned income, up to a yearly maximum the CRA posts. If last year’s earned income was ${usd(EX)}, the room is ${usd(room)} (under the maximum). In your first year of earning there is no room yet: room comes from last year’s income.` },
    { text: `The trade: money put in is a deduction, so it comes off your income before tax. Put in ${usd(ded.put)} and ${usd(ded.inc)} of income is taxed as ${usd(ded.inc - ded.put)}. The other side: money taken out is added to your income and taxed that year as income, and the room you used is not given back.` },
    { text: 'So an RRSP has two sides. An advantage is a deduction now and tax put off while the money grows. A disadvantage is tax later, when it comes out. It is not always better because of the deduction. It depends on your tax rate when you put money in, compared with when you take it out.' },
    { text: 'Outside a registered account, income from investments is taxed. Interest is taxed every year. A dividend, a share of a company’s profit paid to its owners, is taxed in the year you get it. A capital gain, selling for more than you paid, is taxed only when you sell. Rates are for the tax lessons.',
      figure: tbl('When tax is due', ['Kind', 'Outside', 'In an RRSP', 'In a TFSA'], [
        ['Interest', 'Every year', 'When cashed in', 'Not taxed'],
        ['Dividends', 'Year received', 'When cashed in', 'Not taxed'],
        ['Capital gain', 'When sold', 'When cashed in', 'Not taxed']]) },
    { text: 'A tax shelter holds an investment so that tax is put off or removed. An RRSP shelters money until it is cashed in. A TFSA is another registered account: money comes out tax-free, and the room comes back on January 1 of the next year. The choice depends on when you need the money.' },
  ];
  const q1 = 52500, q4 = { inc: 46000, put: 3200 }, q5 = { out: 8000, other: 39500 };
  const incomes = [['Una', 36000], ['Gus', 44000], ['Fay', 52000], ['Hugo', 62000]];
  const target = 8000;
  const ans9 = incomes.reduce((b, [, v], i) => (Math.abs(v * 0.18 - target) < Math.abs(incomes[b][1] * 0.18 - target) ? i : b), 0);
  const questions = [
    num(`${U}-l3-q1`, 'Room from income', `Pia’s earned income last year was ${usd(q1)}. Her RRSP room is 18% of it, and that is less than the yearly maximum. How much room does she have?`,
      { unit: '$', answer: cents(q1 * 0.18), tol: 0, terms: [TERMS.room], hint: 'Multiply last year’s earned income by 0.18.',
        why: 'Room is 18% of last year’s earned income, when that is under the maximum.', working: `${usd(q1)} x 0.18 = ${usd(q1 * 0.18)}.`,
        miss: 'Take 18% of last year’s earned income: multiply by 0.18.', traps: [{ value: cents(q1 * 0.1), why: 'That is 10%. The rule is 18%.' }] }),
    choice(`${U}-l3-q2`, 'A first job', 'Ari starts his first job in March this year. He had no earned income last year. How much RRSP room does this year give him?',
      ['None yet, because room comes from last year’s earned income', 'Room is worked out from last year’s income, and last year it was nothing.'],
      [['18% of what he earns this year', 'This year’s income builds room for later years, not for this one.'],
       ['The yearly maximum, for any new worker', 'The maximum is only a limit on the room. Room still has to come from earned income.']],
      0, 'Which year’s income is the room built from?', [TERMS.room]),
    choice(`${U}-l3-q3`, 'Over the maximum', 'Uma earned a lot last year, so 18% of her earned income is more than the yearly maximum. What is her room this year?',
      ['The yearly maximum, the smaller of the two', 'Room is 18% of last year’s earned income, up to the maximum. When 18% is bigger, the maximum applies.'],
      [['18% of her income, since that is the rule', 'The rule says up to a yearly maximum, so 18% cannot go past it.'],
       ['Nothing, because her income is too high', 'A high income does not remove room. It only means the maximum applies.']],
      1, 'Look for the words “up to a yearly maximum”.', [TERMS.room]),
    num(`${U}-l3-q4`, 'Income after deduction', `Teo’s income is ${usd(q4.inc)}. He puts ${usd(q4.put)} into an RRSP, within his room, and claims the deduction. What income is left to be taxed?`,
      { unit: '$', answer: cents(q4.inc - q4.put), tol: 0, terms: [TERMS.deduction], hint: 'A deduction comes off income before tax is worked out.',
        why: 'The RRSP money is a deduction, so it is subtracted from income before tax.', working: `${usd(q4.inc)} - ${usd(q4.put)} = ${usd(q4.inc - q4.put)}.`,
        miss: 'Subtract the amount put in from the income.', traps: [{ value: cents(q4.inc + q4.put), why: 'That adds the deduction. A deduction is subtracted.' }] }),
    num(`${U}-l3-q5`, 'Cashing in', `Years later Teo takes ${usd(q5.out)} out of the RRSP in a year when his other income is ${usd(q5.other)}. How much income does that year show for tax?`,
      { unit: '$', answer: cents(q5.out + q5.other), tol: 0, terms: [TERMS.rrsp], hint: 'Money taken out of an RRSP is added to income that year.',
        why: 'Money cashed in from an RRSP is taxed as income, so it is added to the other income.', working: `${usd(q5.other)} + ${usd(q5.out)} = ${usd(q5.other + q5.out)}.`,
        miss: 'Money taken out of an RRSP counts as income. Add it to the other income.', traps: [{ value: cents(q5.other), why: 'That leaves out the money taken out. It is added to income.' }] }),
    choice(`${U}-l3-q6`, 'Gain timing', 'Wen bought a share for $400.00. It is now worth $520.00 and Wen has not sold it. Outside a registered account, when is the capital gain taxed?',
      ['Only when Wen sells it', 'A capital gain is taxed when you sell. Until then it is a gain on paper.'],
      [['Every year, like interest', 'Interest is taxed every year. A capital gain waits for the sale.'],
       ['Right now, because the share is worth more', 'A higher price alone does not trigger tax. The sale does.']],
      2, 'Look at the table row for a capital gain.', [TERMS.gain]),
    choice(`${U}-l3-q7`, 'Which payment', 'A company pays Mara $0.40 for each share she owns, out of its profit. What is this payment called?',
      ['A dividend', 'A dividend is a share of a company’s profit paid to its owners.'],
      [['Interest', 'Interest is paid on money lent or saved. A share makes Mara an owner, not a lender.'],
       ['A capital gain', 'A capital gain comes from selling for more than she paid. Nothing was sold here.']],
      0, 'She owns shares, and the money comes out of profit.', [TERMS.dividend]),
    choice(`${U}-l3-q8`, 'Inside an RRSP', 'Yara holds a GIC inside her RRSP for 10 years. When is the interest it earned taxed?',
      ['When she takes the money out of the RRSP, as income', 'The RRSP shelters it until it is cashed in, and then it is taxed as income.'],
      [['Every year, as the interest is earned', 'That is how interest is taxed outside a registered account. An RRSP puts it off.'],
       ['Never, because the money comes out tax-free', 'Tax-free withdrawals belong to a TFSA. RRSP money is taxed as income when it comes out.']],
      1, 'An RRSP shelters money until it is cashed in.', [TERMS.shelter]),
    point(`${U}-l3-q9`, 'Closest to $8,000', `Each bar is a person’s earned income last year. Everyone’s room is 18% of it, under the maximum. Tap the person whose room is closest to ${usd(target)}.`,
      barsFig('Earned income last year', '$', incomes.map(([n, v]) => [n, v * 100])), ans9,
      `${incomes[ans9][0]} has ${usd(incomes[ans9][1])} x 0.18 = ${usd(incomes[ans9][1] * 0.18)}, the closest to ${usd(target)}.`,
      'Multiply each income by 0.18, then compare with $8,000.00.', 'Work out 18% of each bar, then see which result is nearest $8,000.00.', [TERMS.room]),
  ];
  levels.push({ title: 'Registered accounts and tax', learn: ['Say what an RRSP is and work out the room it gives you.', 'Tell how interest, dividends and capital gains are taxed outside a registered account, and what a tax shelter does.'], cards, questions });
}

// =====================================================================================================
// LEVEL 4  Does that number smell right?
// =====================================================================================================
{
  const band = { lo: 2, hi: 4 };                                                             // Lesson 28 line 211 (HISA example return 2% to 4%, 18 to 36 years)
  const dbl = (r) => d((72 / r) * 100) / 100;
  const rows = [[0.4], [3], [30]].map(([r]) => [`${r}%`, `${dbl(r)} years`, dbl(r) >= dbl(band.hi) && dbl(r) <= dbl(band.lo) ? 'Inside' : 'Outside: check']);
  const cards = [
    { text: 'Anyone can post a number about investing, and sites copy each other. Before you use a return you found online, ask three things. Where does it come from? How old is it? Is it a yearly rate? A number with no source and no date is a claim, not yet a fact.' },
    { text: `A quick check is the sniff test. Turn the yearly return into a doubling time with the Rule of 72 (72 / rate) and see whether it looks sensible next to other sources. In this example, three sources put a savings account at ${band.lo}% to ${band.hi}% a year. That is a doubling time of ${dbl(band.hi)} to ${dbl(band.lo)} years.` },
    { text: 'Here are three typed returns for that savings account. Two land outside the range of other sources. Outside the range does not mean wrong. It means look again.',
      figure: tbl('Doubling time for a savings account', ['Typed return', '72 / rate', 'Against 18 to 36'], rows) },
    { text: 'When a number lands outside the range, open the source again. Did you copy the yearly rate, or a monthly rate or a total over 5 years? A page might say 0.4% per month, and 0.4 typed as a yearly rate gives 180 years. A yearly rate is about the monthly rate x 12. Fix a copying mistake.' },
    { text: 'If the page still shows the number, keep it and write “checked twice” beside it. Do not change a correctly sourced number to make it fit. That swaps a real figure for a guess. The test tells you where to look again. It does not tell you what the number should be.' },
    { text: 'A very short doubling time is a flag too. By the rule, under 6 years means a return above 12% a year (72 / 12 = 6). Write “past, not promised” beside it. A fund that did well for a few years shows what happened in those years, not what a 30-year plan can count on.' },
  ];
  const q2r = 0.5, q4t = 16, q5m = 0.35, q8t = 4;
  const typed = [3.2, 0.4, 2.1, 3.8];
  const outlier = typed.findIndex((r) => dbl(r) < dbl(band.hi) || dbl(r) > dbl(band.lo));
  const g = c2(grow(5000, 0.12, 5));
  const questions = [
    choice(`${U}-l4-q1`, 'Claim or fact', 'Ina finds “funds return 15% a year” on a page with no author, no date and no source. What is it, as the cards put it?',
      ['A claim, not yet a fact', 'With no source and no date there is nothing to check it against.'],
      [['A fact, because it is on the internet', 'Sites copy each other, so being online proves nothing.'],
       ['A fact, because it is a number', 'A number can be wrong. It needs a source and a date.']],
      0, 'Look at the first card: source, date and yearly rate.'),
    choice(`${U}-l4-q2`, 'Doubling time', `A page lists a savings account at ${q2r}% a year. By the Rule of 72, how long until money doubles?`,
      [`About ${dbl(q2r)} years`, `72 / ${q2r} = ${dbl(q2r)}.`],
      [[`About ${dbl(q2r) / 10} years`, 'That divides by 5 instead of by 0.5. Divide 72 by the rate as written, 0.5.'],
       [`About ${72 * q2r} years`, 'That multiplies 72 by the rate. The rule divides.']],
      2, 'Divide 72 by the rate.', [TERMS.rule72]),
    choice(`${U}-l4-q3`, 'First step', `In this example other sources put a savings account at ${band.lo}% to ${band.hi}%, a doubling time of ${dbl(band.hi)} to ${dbl(band.lo)} years. Ina’s sheet shows ${dbl(q2r)} years. What is her first step?`,
      ['Open the source again and check the rate it shows', 'The sniff test says where to look again. The page may show a monthly rate or a total.'],
      [['Change the rate to 3% so it fits the range', 'A fit-the-range change swaps a real figure for a guess.'],
       ['Delete the row because it is wrong', 'Outside the range does not mean wrong. Check the source first.']],
      1, 'The test says look again, not change.', [TERMS.sniff]),
    num(`${U}-l4-q4`, 'Rate from years', `A bond fund’s row shows money doubling in ${q4t} years. By the Rule of 72, about what yearly rate is that?`,
      { unit: '%', answer: 72 / q4t, tol: 0, terms: [TERMS.rule72], hint: 'The rule runs backwards: divide 72 by the years.',
        why: 'The rate is about 72 divided by the years to double.', working: `72 / ${q4t} = ${72 / q4t}%.`,
        miss: 'Divide 72 by the number of years, not the other way around.', traps: [{ value: 72 * q4t, why: 'That multiplies. The rule divides 72 by the years.' }] }),
    num(`${U}-l4-q5`, 'Monthly to yearly', `A page says a savings account pays ${q5m}% per month. Rey typed ${q5m} as the yearly rate. About what yearly rate does the page show? Multiply the monthly rate by 12.`,
      { unit: '%', answer: c2(q5m * 12), tol: 0.05, hint: 'There are 12 months in a year.',
        why: 'A monthly rate is about a twelfth of the yearly rate, so the yearly rate is about 12 times it.', working: `${q5m}% x 12 = ${c2(q5m * 12)}%.`,
        miss: 'The page gives one month. Multiply by the number of months in a year.', traps: [{ value: c2(q5m / 12), why: 'That divides. A year has more months than one, so the yearly rate is bigger.' }] }),
    choice(`${U}-l4-q6`, 'Keep or change', 'Eli checks the page twice. It still says 9% a year for a bond fund, outside the 3% to 5% her other sources give in this example. What do the cards say to do?',
      ['Keep 9% and write “checked twice” beside it', 'A correctly sourced number stays. The note shows she looked again.'],
      [['Change it to 5% so it sits in the range', 'Changing a sourced number to fit the range is worse than the first mistake.'],
       ['Remove the fund from her list', 'An unusual number is not a reason to drop the fund. It is a reason to look twice.']],
      2, 'Look at the card on what to do if the page still shows the number.'),
    point(`${U}-l4-q7`, 'Fails the test', `In this example a savings account should double in 18 to 36 years. Each bar is a typed yearly rate. Tap the one whose doubling time falls outside that range.`,
      barsFig('Typed yearly rates', '%', typed.map((r, i) => [`Row ${i + 1}`, r])), outlier,
      `${typed[outlier]}% gives 72 / ${typed[outlier]} = ${dbl(typed[outlier])} years, far outside 18 to 36. The others give ${typed.filter((_, i) => i !== outlier).map((r) => c2(dbl(r))).join(', ')} years, all inside.`,
      'Divide 72 by each rate and compare with 18 to 36 years.', 'Work out 72 / rate for each bar. One result is far outside 18 to 36.', [TERMS.sniff]),
    choice(`${U}-l4-q8`, 'Short stretch', `A page says a stock fund doubled in ${q8t} years. Cal wants a rate for a 30-year plan. What do the cards say?`,
      [`That is about ${72 / q8t}% a year over a short stretch, so mark it “past, not promised”`, 'A doubling time under 6 years is a flag. A short stretch is not what a 30-year plan can count on.'],
      [['Use it, since the newest number is the best', 'Recent is not the same as reliable. A short stretch is past, not promised.'],
       ['Ignore the fund, since that return cannot be true', 'The number may be real for that stretch. It is just not a promise.']],
      0, 'Turn 4 years into a yearly rate, then think about how short the stretch is.', [TERMS.rule72]),
    num(`${U}-l4-q9`, 'Past growth', 'A made-up fund grew 12% a year for the last 5 years. Multiply $5,000.00 by 1.12 five times. How much would it be after 5 years, to the nearest dollar?',
      { unit: '$', answer: cents(d(g)), tol: 50, hint: 'Multiply by 1.12 once for each year.',
        why: 'Each year multiplies the balance by 1.12. This shows what the money would have done, not what comes next.', working: `$5,000 x 1.12^5 = ${usd(g)}, about ${usd(d(g), 0)}.`,
        miss: 'Multiply by 1.12, five times in a row.', traps: [{ value: cents(5000 * (1 + 0.12 * 5)), why: 'That adds 12% of $5,000 each year. Interest is on the growing balance, so it is more.' }] }),
  ];
  levels.push({ title: 'Does that number smell right?', learn: ['Turn a yearly return into a doubling time to check a number you found online.', 'Say what to do when a number looks wrong, and why a short good stretch is not a promise.'], cards, questions });
}

// ---- assemble ----
const unit = {
  id: U,
  title: 'A plan for a lifetime',
  blurb: 'Two goals and an emergency fund, the payment that gets you there, RRSPs and tax, and checking a number you find online.',
  outcome_codes: ['FIN3090 3.6', 'FIN3090 3.7', 'FIN3090 3.9', 'FIN3090 3.11', 'FIN3090 4.4.1', 'FIN3090 4.4.2', 'FIN3090 4.7'],
  levels: levels.map((l, i) => ({
    id: `${U}-l${i + 1}`, title: l.title, kind: 'lesson', learn: l.learn, cards: l.cards,
    questions: l.questions.map((q, j) => ({ ...q, id: `${U}-l${i + 1}-q${j + 1}`, label: q.label })),
  })),
};
fs.writeFileSync(new URL('../draft/ft2030-s3-u8.json', import.meta.url), `${JSON.stringify(unit, null, 2)}\n`);
console.log('wrote draft', unit.levels.map((l) => `${l.cards.length}c/${l.questions.length}q`).join(' '));
