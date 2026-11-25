import { readFileSync } from 'node:fs';
// FinWord (the daily word game, docs/arcade.md): the word list. NOT under ui/, because /m/arcade/ serves ui/ to browsers and the answers must stay on the server.
// Each entry: word (4-9 letters A-Z), term + meaning copied verbatim from the course's lesson file (modules/learn/content), section = that unit's section title (the hint).
// A word is a one-word term, or one word of a longer term that carries its meaning. Order matters: day number mod length picks the word, and neighbours come from different sections.
// Mr. Tang can reorder, delete or add entries (see REVIEW-wordle.md). A game in progress keeps its own copy of the word.
export const ALL_WORDS = {
  fintech10: [
    {"word":"NEED","term":"need","meaning":"Something you must have to live and work, such as food or a way to get to work.","section":"Money & You"},
    {"word":"SAVING","term":"saving","meaning":"Money kept safe and ready for something soon.","section":"Investing Foundations"},
    {"word":"WANT","term":"want","meaning":"Something you would like to have but could live without.","section":"Money & You"},
    {"word":"INVESTING","term":"investing","meaning":"Putting money to work so it can grow for something far away.","section":"Investing Foundations"},
    {"word":"HABIT","term":"habit","meaning":"Something you do without deciding each time.","section":"Money & You"},
    {"word":"BALANCE","term":"balance","meaning":"The amount an account holds.","section":"Investing Foundations"},
    {"word":"BUDGET","term":"budget","meaning":"A plan for what each dollar of a month is for.","section":"Money & You"},
    {"word":"BORROWER","term":"borrower","meaning":"A person who gets money now and agrees to pay it back.","section":"Credit & Borrowing"},
    {"word":"LENDER","term":"lender","meaning":"A person or business that lends money and expects it back.","section":"Money & You"},
    {"word":"PRINCIPAL","term":"principal","meaning":"The money you start with, before any interest is added.","section":"Investing Foundations"},
    {"word":"WAGE","term":"wage","meaning":"A set rate of pay for each hour you work.","section":"Money & You"},
    {"word":"INCOME","term":"income","meaning":"The money that comes in to you each month.","section":"Credit & Borrowing"},
    {"word":"SALARY","term":"salary","meaning":"A set amount for the year, paid in equal parts.","section":"Money & You"},
    {"word":"BARTER","term":"barter","meaning":"Trading goods or services for other goods or services, with no money.","section":"Money Systems & Crypto"},
    {"word":"DEDUCTION","term":"deduction","meaning":"An amount taken off your gross pay, such as CPP, EI or tax.","section":"Money & You"},
    {"word":"DOUBLING","term":"doubling","meaning":"Money growing to twice its size, such as $1,000 becoming $2,000.","section":"Investing Foundations"},
    {"word":"EXEMPTION","term":"exemption","meaning":"A first part of pay that this deduction does not charge.","section":"Money & You"},
    {"word":"CDIC","term":"CDIC","meaning":"A federal protection for deposits at banks. It pays back deposits, up to a limit, if a bank goes under.","section":"Credit & Borrowing"},
    {"word":"PREMIUM","term":"premium","meaning":"The amount you pay into an insurance plan, here from each pay.","section":"Money & You"},
    {"word":"HISA","term":"HISA","meaning":"High-interest savings account.","section":"Money Systems & Crypto"},
    {"word":"BRACKET","term":"bracket","meaning":"A slice of income taxed at one rate.","section":"Money & You"},
    {"word":"INFLATION","term":"inflation","meaning":"A rise in prices in general. The yearly rate says by how many percent.","section":"Investing Foundations"},
    {"word":"OVERTIME","term":"overtime","meaning":"Extra pay (or time off) for working more than the legal limit.","section":"Money & You"},
    {"word":"STATEMENT","term":"statement","meaning":"The monthly summary of what you bought, what you owe and what you must pay.","section":"Credit & Borrowing"},
    {"word":"CURRENCY","term":"currency","meaning":"The money a country uses, such as Canadian dollars or US dollars.","section":"Money Systems & Crypto"},
    {"word":"INTEREST","term":"interest","meaning":"Money a bank pays you for keeping your savings with it.","section":"Money & You"},
    {"word":"BASKET","term":"basket","meaning":"A made-up list of everyday things, used to follow what the same shopping costs.","section":"Investing Foundations"},
    {"word":"PAYMENT","term":"payment","meaning":"The amount you pay the lender each month on a loan.","section":"Credit & Borrowing"},
    {"word":"FLOATING","term":"floating","meaning":"The rate is set by buyers and sellers of the money, and it moves.","section":"Money Systems & Crypto"},
    {"word":"LIABILITY","term":"liability","meaning":"A debt: something the business owes to someone else.","section":"Accounting Prep"},
    {"word":"ALIS","term":"ALIS","meaning":"The Alberta government career website (alis.alberta.ca). Albertans look up what an occupation pays there.","section":"Money & You"},
    {"word":"LIQUIDITY","term":"liquidity","meaning":"How fast you can turn something into cash without losing value.","section":"Investing Foundations"},
    {"word":"RENEWAL","term":"renewal","meaning":"Signing a new term, at whatever the rate is then.","section":"Credit & Borrowing"},
    {"word":"PEGGED","term":"pegged","meaning":"The government fixes the rate and holds it there.","section":"Money Systems & Crypto"},
    {"word":"GAAP","term":"GAAP","meaning":"Generally accepted accounting principles: the shared rules for keeping books, so that statements can be trusted and compared.","section":"Accounting Prep"},
    {"word":"PROFIT","term":"profit","meaning":"What is left when the costs are taken away from the sales. In the books it is called net income.","section":"FinTech Marketplace"},
    {"word":"RENT","term":"rent","meaning":"The money you pay each month to live in a place you do not own.","section":"Money & You"},
    {"word":"TICKER","term":"ticker","meaning":"A short code, a few letters, that names one company or fund on an exchange.","section":"Investing Foundations"},
    {"word":"LANDLORD","term":"landlord","meaning":"The person who owns a home and rents it to you.","section":"Credit & Borrowing"},
    {"word":"IMPORT","term":"import","meaning":"A good a country buys from another country.","section":"Money Systems & Crypto"},
    {"word":"EXPENSE","term":"expense","meaning":"A cost of running the business. It lowers the owner's equity.","section":"Accounting Prep"},
    {"word":"MISSION","term":"mission","meaning":"One sentence that says what the business is for.","section":"FinTech Marketplace"},
    {"word":"MORTGAGE","term":"mortgage","meaning":"A loan used to buy a home, paid back over many years.","section":"Money & You"},
    {"word":"DIVIDEND","term":"dividend","meaning":"Cash a company pays to its owners.","section":"Investing Foundations"},
    {"word":"LEASE","term":"lease","meaning":"The agreement that sets the rent and how long you can stay.","section":"Credit & Borrowing"},
    {"word":"EXPORT","term":"export","meaning":"A good a country sells to another country.","section":"Money Systems & Crypto"},
    {"word":"REVENUE","term":"revenue","meaning":"Money the business earns from its work. It raises the owner's equity.","section":"Accounting Prep"},
    {"word":"MEMO","term":"memo","meaning":"A short written message to people inside a business.","section":"FinTech Marketplace"},
    {"word":"INSURANCE","term":"insurance","meaning":"A plan you pay for so that the plan covers some of the cost if something goes wrong.","section":"Money & You"},
    {"word":"SPREAD","term":"spread","meaning":"The gap between the ask and the bid. Buying and selling right away costs you the gap.","section":"Investing Foundations"},
    {"word":"EQUITY","term":"equity","meaning":"The part of a home that is yours: its value minus what you still owe.","section":"Credit & Borrowing"},
    {"word":"TARIFF","term":"tariff","meaning":"A tax on goods that come in from another country.","section":"Money Systems & Crypto"},
    {"word":"DRAWINGS","term":"drawings","meaning":"Money the owner takes out for personal use. It lowers the owner's equity, and it is not an expense.","section":"Accounting Prep"},
    {"word":"MARKUP","term":"markup","meaning":"The amount added to the cost per unit to make the price.","section":"FinTech Marketplace"},
    {"word":"DEPOSIT","term":"deposit","meaning":"Money you hand over when you move in and get back when you move out, if nothing is damaged.","section":"Money & You"},
    {"word":"DRIP","term":"DRIP","meaning":"Reinvesting a dividend: it buys more of the same stock instead of arriving as cash.","section":"Investing Foundations"},
    {"word":"ASSET","term":"asset","meaning":"Something you own that is worth money.","section":"Credit & Borrowing"},
    {"word":"DUMPING","term":"dumping","meaning":"Selling in another country for less than the price at home.","section":"Money Systems & Crypto"},
    {"word":"DEBIT","term":"debit","meaning":"An entry on the left side of an account.","section":"Accounting Prep"},
    {"word":"PROMOTION","term":"promotion","meaning":"How a business tells its target market about the product.","section":"FinTech Marketplace"},
    {"word":"ENVELOPE","term":"envelope","meaning":"A set amount of cash kept for one category. When it is empty, you stop.","section":"Money & You"},
    {"word":"OBJECTIVE","term":"objective","meaning":"What you want, with an amount.","section":"Investing Foundations"},
    {"word":"DEBT","term":"debt","meaning":"Money you owe. Also called a liability.","section":"Credit & Borrowing"},
    {"word":"LEDGER","term":"ledger","meaning":"A list of every payment, in order.","section":"Money Systems & Crypto"},
    {"word":"CREDIT","term":"credit","meaning":"An entry on the right side of an account.","section":"Accounting Prep"},
    {"word":"INVENTORY","term":"inventory","meaning":"Goods bought to be sold and not yet sold.","section":"FinTech Marketplace"},
    {"word":"GROSS","term":"gross pay","meaning":"Your pay before anything is taken off.","section":"Money & You"},
    {"word":"STRATEGY","term":"strategy","meaning":"A rule for how you will reach the goal, or what you will not do.","section":"Investing Foundations"},
    {"word":"GRACE","term":"grace period","meaning":"The time between the statement and the due date. Pay in full and no interest is charged.","section":"Credit & Borrowing"},
    {"word":"HASH","term":"hash","meaning":"One guess in the proof-of-work race.","section":"Money Systems & Crypto"},
    {"word":"JOURNAL","term":"journal","meaning":"The book where each transaction is first written, in date order, as debits and credits.","section":"Accounting Prep"},
    {"word":"FORECAST","term":"forecast","meaning":"A careful estimate of future sales and costs, made before they happen.","section":"FinTech Marketplace"},
    {"word":"STUB","term":"pay stub","meaning":"The slip that shows your gross pay, deductions and net pay.","section":"Money & You"},
    {"word":"COMPOUND","term":"compound interest","meaning":"Interest added to the balance, so later interest is figured on interest too.","section":"Investing Foundations"},
    {"word":"PAYDAY","term":"payday loan","meaning":"A short loan from a store, repaid on your next payday, with a fee for every $100 borrowed.","section":"Credit & Borrowing"},
    {"word":"COMMODITY","term":"commodity money","meaning":"Money that is worth something by itself, such as a gold coin.","section":"Money Systems & Crypto"},
    {"word":"POSTING","term":"posting","meaning":"Copying each debit and credit from the journal into its account in the ledger.","section":"Accounting Prep"},
    {"word":"RISK","term":"risk","meaning":"Something that could go wrong and cost the business money.","section":"FinTech Marketplace"},
    {"word":"VACATION","term":"vacation pay","meaning":"A share of your earnings that is set aside for time off.","section":"Money & You"},
    {"word":"HORIZON","term":"time horizon","meaning":"How long your money can stay put before you need it.","section":"Investing Foundations"},
    {"word":"CONDO","term":"condo fee","meaning":"A monthly fee for the shared parts of a condo or townhouse building.","section":"Credit & Borrowing"},
    {"word":"FIAT","term":"fiat money","meaning":"Money that works because of an order from the government, not because of what it is made of. Fiat means \"by order\".","section":"Money Systems & Crypto"},
    {"word":"EQUATION","term":"accounting equation","meaning":"Assets = Liabilities + Owner's Equity. It is true after every transaction.","section":"Accounting Prep"},
    {"word":"MARKETING","term":"marketing mix","meaning":"The four choices that shape how a product is sold: product, price, place and promotion. Also called the 4 Ps.","section":"FinTech Marketplace"},
    {"word":"HOURLY","term":"hourly wage","meaning":"A set amount of pay for each hour you work.","section":"Money & You"},
    {"word":"YIELD","term":"dividend yield","meaning":"The dividend for a year, as a percent of the price.","section":"Investing Foundations"},
    {"word":"ADVANCE","term":"cash advance","meaning":"Cash taken out of a bank machine with a credit card. It is a loan from the card.","section":"Credit & Borrowing"},
    {"word":"EXCHANGE","term":"exchange rate","meaning":"The price of one money in another money.","section":"Money Systems & Crypto"},
    {"word":"PAYABLE","term":"accounts payable","meaning":"Money the business owes its suppliers for things already received.","section":"Accounting Prep"},
    {"word":"VARIABLE","term":"variable cost","meaning":"A cost that grows with each item sold.","section":"FinTech Marketplace"},
  ],
  fintech2030: [
    {"word":"DEPOSIT","term":"deposit","meaning":"Money you put into an account or an investment.","section":"The Investor"},
    {"word":"MUNICIPAL","term":"municipal","meaning":"The level of government of a city or town.","section":"The Taxpayer"},
    {"word":"BALANCE","term":"balance","meaning":"What the account or investment holds right now: your deposits plus the growth so far.","section":"The Investor"},
    {"word":"RETURN","term":"return","meaning":"The form that reports your income and works out your tax.","section":"The Taxpayer"},
    {"word":"GROWTH","term":"growth","meaning":"The balance minus what you put in. It is the money the money earned.","section":"The Investor"},
    {"word":"BENEFIT","term":"benefit","meaning":"A payment to people who qualify for it.","section":"The Taxpayer"},
    {"word":"EQUITIES","term":"equities","meaning":"Shares: pieces of a business you own.","section":"The Investor"},
    {"word":"REFUND","term":"refund","meaning":"Money the government pays back to you when the tax withheld is more than the tax you owe.","section":"The Taxpayer"},
    {"word":"INFLATION","term":"inflation","meaning":"A rise in prices over time, so the same dollars buy less.","section":"The Investor"},
    {"word":"DEDUCTION","term":"deduction","meaning":"An amount you may subtract from your income before tax is worked out, such as an RRSP contribution.","section":"The Taxpayer"},
    {"word":"COUPON","term":"coupon","meaning":"The fixed payment a bond makes each year.","section":"The Investor"},
    {"word":"NETFILE","term":"NETFILE","meaning":"NETFILE is the CRA service that carries your return from certified tax software to the CRA over the internet.","section":"The Taxpayer"},
    {"word":"MATURITY","term":"maturity","meaning":"The date a bond ends and the face value is paid back.","section":"The Investor"},
    {"word":"COMPOUND","term":"compound","meaning":"Interest is charged on the interest already added.","section":"The Taxpayer"},
    {"word":"DEBENTURE","term":"debenture","meaning":"A company bond backed only by the company’s promise to pay.","section":"The Investor"},
    {"word":"WITHHELD","term":"tax withheld","meaning":"Income tax your employer took off each paycheque and sent to the government for you.","section":"The Taxpayer"},
    {"word":"PRINCIPAL","term":"principal","meaning":"The amount of money you lend.","section":"The Investor"},
    {"word":"TAXABLE","term":"taxable income","meaning":"Your total income minus your deductions. Tax is worked out on this amount.","section":"The Taxpayer"},
    {"word":"PREMIUM","term":"premium","meaning":"A price above face value.","section":"The Investor"},
    {"word":"INCLUSION","term":"inclusion rate","meaning":"The fraction of a capital gain that counts as income and gets taxed.","section":"The Taxpayer"},
    {"word":"DISCOUNT","term":"discount","meaning":"A price below face value.","section":"The Investor"},
    {"word":"CAPITAL","term":"capital gain","meaning":"A sale for more than the total of its ACB and the outlays and expenses incurred to sell. In our examples: the sale price minus what was paid.","section":"The Taxpayer"},
    {"word":"SECTOR","term":"sector","meaning":"A group of companies that do similar business.","section":"The Investor"},
    {"word":"SURVEY","term":"survey","meaning":"A short set of questions asked to many people, to learn what they do and want.","section":"The Venture"},
    {"word":"REIT","term":"REIT","meaning":"A real estate investment trust. It owns buildings that earn rent and pays most of the rent out to its owners.","section":"The Investor"},
    {"word":"IDENTITY","term":"identity theft","meaning":"Someone uses your details to pretend to be you.","section":"The Taxpayer"},
    {"word":"NOMINAL","term":"nominal","meaning":"The dollar amount shown on a statement, before prices are taken into account.","section":"The Investor"},
    {"word":"MARKET","term":"market","meaning":"The people who are in the right place, at the right time, with the right need and money.","section":"The Venture"},
    {"word":"SCREEN","term":"screen","meaning":"A rule plus facts about each company, used to decide which companies an investor will own.","section":"The Investor"},
    {"word":"DISPUTE","term":"in dispute","meaning":"Not agreed. The taxpayer and the CRA see the amount differently.","section":"The Taxpayer"},
    {"word":"TOLERANCE","term":"risk tolerance","meaning":"How big a drop a person can sit through without panicking. It differs from person to person.","section":"The Investor"},
    {"word":"CONCEPT","term":"business concept","meaning":"A short, clear description of a business idea that answers four questions.","section":"The Venture"},
    {"word":"COMPANY","term":"company risk","meaning":"The chance that one company does badly or fails, whatever the rest of the market does.","section":"The Investor"},
    {"word":"OWING","term":"balance owing","meaning":"The tax you still owe when you do your taxes.","section":"The Taxpayer"},
    {"word":"BLENDED","term":"blended return","meaning":"The return of a whole mix, worked out from the return of each part and how much money is in it.","section":"The Investor"},
    {"word":"LEADING","term":"leading question","meaning":"A question that hints at the answer the asker wants.","section":"The Venture"},
    {"word":"LANDFILL","term":"landfill waste","meaning":"Waste that is buried instead of reused or recycled.","section":"The Investor"},
    {"word":"CREDIT","term":"non-refundable tax credit","meaning":"An amount that lowers the tax you owe, but cannot take it below $0. The basic personal amount is one.","section":"The Taxpayer"},
    {"word":"MEETING","term":"annual meeting","meaning":"The yearly meeting where a company’s shareholders vote.","section":"The Investor"},
    {"word":"MARGIN","term":"contribution margin","meaning":"The price minus the variable cost of one item. What each sale puts toward the fixed costs.","section":"The Venture"},
    {"word":"DOUBLING","term":"doubling time","meaning":"How long money takes to become twice as large.","section":"The Investor"},
    {"word":"INDEX","term":"index fund","meaning":"A fund that holds every company on a list, so one purchase covers them all.","section":"The Investor"},
    {"word":"ASSET","term":"asset class","meaning":"A group of things to put money into that behave in a similar way.","section":"The Investor"},
    {"word":"INSURANCE","term":"deposit insurance","meaning":"Protection that gives deposits back, up to a limit, if the institution fails.","section":"The Investor"},
    {"word":"YIELD","term":"market yield","meaning":"The rate new bonds like it pay today.","section":"The Investor"},
  ],
};

// ---- the rules (server only) ----
export const WORDLE_TITLE = 'FinWord';
export const MAX_GUESSES = 6;
// What the game uses: only the entries whose term and meaning are in the course's lesson file on this server, so a word from a section that is
// not live yet stays out until its lessons ship (then the day-to-word order shifts; a game in progress keeps its stored word).
const lessonPairs = (course) => {
  const pairs = new Map();                                             // "term\0meaning" -> title of the unit it is taught in (the first one found)
  const walk = (o, unit) => {
    if (Array.isArray(o)) o.forEach((x) => walk(x, unit));
    else if (o && typeof o === 'object') {
      if (Array.isArray(o.levels) && typeof o.title === 'string') unit = o.title;     // a unit: { id, title, levels }
      if (o.term && o.meaning && !pairs.has(`${o.term}\u0000${o.meaning}`)) pairs.set(`${o.term}\u0000${o.meaning}`, unit);
      Object.values(o).forEach((x) => walk(x, unit));
    }
  };
  try { walk(JSON.parse(readFileSync(new URL(`../learn/content/${course}.json`, import.meta.url), 'utf8'))); } catch { /* no lesson file: no words */ }
  return pairs;
};
const PAIRS = Object.fromEntries(Object.keys(ALL_WORDS).map((c) => [c, lessonPairs(c)]));
export const WORDS = Object.fromEntries(Object.entries(ALL_WORDS).map(([course, list]) => [course, list.filter((e) => PAIRS[course].has(`${e.term}\u0000${e.meaning}`))]));

// Hints are earned by misses and built here, on the server, so a locked hint never reaches the browser. Level 1 is free (the section, blanked like the others), level 2 after 2 misses
// (the lesson's title), level 3 after 4 (the meaning). In the two hint texts every occurrence of the answer and of each 4+ letter word of the term becomes underscores.
export const HINT_AFTER = [0, 2, 4];
const bases = (e) => [...new Set([e.word, ...e.term.split(/[^A-Za-z]+/).filter((w) => w.length >= 4)].map((w) => w.toLowerCase()))].sort((x, y) => y.length - x.length);
const prefix = (a, b) => { let n = 0; while (n < a.length && a[n] === b[n]) n++; return n; };
// A word is given away when it holds the answer or a term word, or shares a stem with one: a common prefix of at least 4 letters ("invest", "lends", "borrow").
export const givesAway = (w, e) => { w = w.toLowerCase(); return w.length >= 4 && bases(e).some((b) => w.includes(b) || prefix(w, b) >= 4); };
const blank = (text, e) => {
  const words = bases(e);
  return text.replace(new RegExp(words.join('|'), 'gi'), (m) => '_'.repeat(m.length)).replace(/[A-Za-z]{4,}/g, (w) => (givesAway(w, e) ? '_'.repeat(w.length) : w));
};
// A hint with fewer than 2 words left that show real letters is no help: that tier is skipped.
const useful = (t) => t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w) && !w.includes('_')).length >= 2;
export const unitTitle = (course, e) => PAIRS[course]?.get(`${e.term}\u0000${e.meaning}`) || '';
export const hintTexts = (course, e) => [
  { level: 1, label: 'From the section', text: blank(e.section, e) },   // blanked too ("Investing Foundations" for INVESTING); always shown
  ...(unitTitle(course, e) ? [{ level: 2, label: 'From the lesson', text: blank(unitTitle(course, e), e) }] : []),
  ...(e.meaning ? [{ level: 3, label: 'What it means', text: blank(e.meaning, e) }] : []),
].filter((h) => h.text && (h.level === 1 || useful(h.text)));
export const hintsFor = (course, e, misses) => hintTexts(course, e).filter((h) => misses >= HINT_AFTER[h.level - 1]);

const DAY0 = Date.UTC(2026, 0, 1);
export const dayNumber = (day) => { const [y, m, d] = day.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - DAY0) / 864e5); };

// The entry for a day ('YYYY-MM-DD') and course: list[days since 2026-01-01 mod length]. Depends on the date and course only, never the player.
export function wordFor(course, day) {
  const list = Object.hasOwn(WORDS, course) ? WORDS[course] : null;
  if (!list?.length) return null;
  return list[((dayNumber(day) % list.length) + list.length) % list.length];
}

// Standard Wordle marking: greens first, then yellows from the letters still unused, so a repeated letter is marked no more often than the answer holds it.
export function mark(answer, guess) {
  const marks = Array(answer.length).fill('miss'), left = {};
  for (let i = 0; i < answer.length; i++) { if (guess[i] === answer[i]) marks[i] = 'hit'; else left[answer[i]] = (left[answer[i]] ?? 0) + 1; }
  for (let i = 0; i < answer.length; i++) if (marks[i] === 'miss' && left[guess[i]] > 0) { marks[i] = 'near'; left[guess[i]]--; }
  return marks;
}
