// The 2025 tax-year figures for the FinTech 20 tax section, pinned from official pages (canada.ca / CRA only; the Alberta figures are on the
// CRA's Alberta pages and form AB428). Mr. Tang chose the 2025 tax year throughout the section; the game itself stays on 2026 (modules/jobs/payroll.js).
// Every fact is { value, quote, url, read }. quote = exact words of the page (25 words or fewer; text pulled out of a PDF reads as the PDF lays it out).
// Dollar amounts are integer cents. Rates are in 1/10000 (1% = 100; 14.5% = 1450). The quotes were checked against the fetched page text by script on READ.
// Anything the pages did not give is in MISSING (the 3,500 x months / 12 reading of the proration is ours; the CRA quote only says "the portion ... applicable to that pay period"); nothing here is from memory.

export const READ = '2026-11-15';
const f = (value, quote, url) => ({ value, quote, url, read: READ });
const CRA = 'https://www.canada.ca/en/revenue-agency/services';
const LAST_YEAR = `${CRA}/tax/individuals/tax-rates-brackets/last-year.html`;
const DED = `${CRA}/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses`;
const CPP_PAGE = `${CRA}/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html`;
const CPP2_PAGE = `${CRA}/tax/businesses/topics/payroll/calculating-deductions/making-deductions/second-additional-cpp-contribution-rates-maximums.html`;
const EI_PAGE = `${CRA}/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html`;
const WHATS_NEW = `${CRA}/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/whats-new.html`;
const PKG = 'https://www.canada.ca/content/dam/cra-arc/formspubs/pbg';
const AB_INFO = `${CRA}/forms-publications/tax-packages-years/general-income-tax-benefit-package/alberta/5009-pc.html`;

// ---- Federal ----
const fedRow = (from, to, bp, quote) => f({ from, to, rateBp: bp }, quote, LAST_YEAR);
export const FED_BRACKETS = [
  fedRow(0, 5737500, 1450, '$0 $57,375 14.5% Footnote 1'),
  fedRow(5737500, 11475000, 2050, '$57,375.01 $114,750 20.5%'),
  fedRow(11475000, 17788200, 2600, '$114,750.01 $177,882 26%'),
  fedRow(17788200, 25341400, 2900, '$177,882.01 $253,414 29%'),
  fedRow(25341400, null, 3300, '$253,414.01 unlimited 33%'),
];
export const FED_LOWEST_RATE = f(1450, 'The federal tax rate decreased from 15% to 14% on July 1, 2025, making the tax rate 14.5% for 2025.', LAST_YEAR);
// The CRA says the rate for credits is the same as the lowest rate, and that the full-year 2025 lowest rate is 14.5%.
export const FED_CREDIT_RATE = f(1450, 'The rate applying to most non-refundable tax credits will continue to be the same as the lowest marginal individual income tax rate.', WHATS_NEW);
export const FED_CREDIT_RATE_YEAR = f(1450, 'the full-year lowest marginal individual income tax rate for 2025 will be 14.5%.', WHATS_NEW);
export const FED_BPA = f(1612900, '$177,882 or less , claim $16,129', `${DED}/line-30000-basic-personal-amount.html`);
export const FED_BPA_MIN = f(1453800, 'more than $253,414 , claim $14,538', `${DED}/line-30000-basic-personal-amount.html`);   // BPA is reduced between $177,882 and $253,414 of net income (Federal Worksheet); not modelled
export const FED_BPA_REDUCTION_START = f(17788200, '$177,882 or less , claim $16,129', `${DED}/line-30000-basic-personal-amount.html`);
export const FED_BPA_REDUCTION_END = f(25341400, 'more than $253,414 , claim $14,538', `${DED}/line-30000-basic-personal-amount.html`);
export const CANADA_EMPLOYMENT_AMOUNT = f(147100, '$1,471 (maximum amount for 2025)', `${DED}/line-31260-canada-employment-amount.html`);
// The Top-up tax credit (new for 2025) keeps a 15% rate for credits above the first bracket; it is 0 unless the credits' value is over $8,319.38.
export const TOPUP_THRESHOLD = f(831938, '8,319.38 Line 3 minus line 4 (if negative, enter "0")= Applicable rate × 3.45%', `${PKG}/5000-d1/5000-d1-25e.pdf`);
export const TOPUP_RATE = f(345, '8,319.38 Line 3 minus line 4 (if negative, enter "0")= Applicable rate × 3.45%', `${PKG}/5000-d1/5000-d1-25e.pdf`);
export const TOPUP_WHY = f('only for credits over the first bracket threshold of $57,375', 'effectively maintains a 15% rate for certain non-refundable tax credits claimed on amounts over the first income tax bracket threshold of $57,375 for 2025.', `${DED}/line-34990-top-up-tax-credit.html`);

// ---- CPP ----
export const CPP_ROW = f({ ympe: 7130000, exemption: 350000, rateBp: 595, maxContribution: 403410 }, '2025 $71,300 $3,500 $67,800 5.95 $4,034.10 $8,068.20', CPP_PAGE);
export const YMPE = f(7130000, 'For 2025, the YMPE is $71,300 and the YAMPE is $81,200.', `${DED}/line-22215-deduction-for-cpp-or-qpp-enhanced-contributions-on-employment-income.html`);
export const CPP_EXEMPTION = f(350000, '2025 $71,300 $3,500 $67,800 5.95 $4,034.10 $8,068.20', CPP_PAGE);
export const CPP_RATE = f(595, '2025 $71,300 $3,500 $67,800 5.95 $4,034.10 $8,068.20', CPP_PAGE);
// The exemption is applied by pay period; we read that as $3,500 x months worked / 12 (twelve monthly pay periods), with the months the T4 states.
export const CPP_PRORATE = f('the portion of the annual exemption applicable to that pay period', 'you must subtract the portion of the annual exemption applicable to that pay period before calculating the CPP contributions for the period.', CPP_PAGE);
export const CPP_MAX = f(403410, '2025 $71,300 $3,500 $67,800 5.95 $4,034.10 $8,068.20', CPP_PAGE);
// base 4.95% (the credit, line 30800) and first additional 1% (the deduction, line 22215); both per CRA Schedule 8 for 2025
export const CPP_BASE_RATE = f(495, '× 4.95% = (maximum $3,356.10)', `${PKG}/5000-s8/5000-s8-25e.pdf`);
export const CPP_FIRST_ADDITIONAL_RATE = f(100, '× 1% = (maximum $678.00)', `${PKG}/5000-s8/5000-s8-25e.pdf`);
export const CPP_BASE_SHARE = f('83.1933%', 'Total actual base and first additional contributions on CPP pensionable earnings from box 16 × 83.1933% =', `${PKG}/5000-s8/5000-s8-25e.pdf`);
export const CPP_BASE_MAX = f(335610, 'Do not claim more than $3,356.10 on line 30800 of your return for your base contributions on employment income', `${DED}/line-30800-cpp-qpp-contributions-through-employment.html`);
export const CPP_DEDUCTION_MAX = f(107400, 'the maximum allowable deduction is $1,074.00. This amount consists of a maximum first additional amount of $678.00 and a second additional amount of $396.00', `${DED}/line-22215-deduction-for-cpp-or-qpp-enhanced-contributions-on-employment-income.html`);
export const CPP2_YAMPE = f(8120000, '2025 $81,200 4% $396 $792', CPP2_PAGE);
export const CPP2_RATE = f(400, '2025 $81,200 4% $396 $792', CPP2_PAGE);
export const CPP2_MAX = f(39600, '2025 $81,200 4% $396 $792', CPP2_PAGE);

// ---- EI (outside Quebec) ----
export const EI_ROW = f({ mie: 6570000, rateBp: 164, maxPremium: 107748 }, '2025 $65,700 1.64 $1,077.48 $1,508.47', EI_PAGE);
export const EI_RATE = f(164, '2025 $65,700 1.64 $1,077.48 $1,508.47', EI_PAGE);
export const EI_MIE = f(6570000, '2025 $65,700 1.64 $1,077.48 $1,508.47', EI_PAGE);
export const EI_MAX = f(107748, '2025 $65,700 1.64 $1,077.48 $1,508.47', EI_PAGE);

// ---- Alberta ----
const abRow = (from, to, bp, quote) => f({ from, to, rateBp: bp }, quote, LAST_YEAR);
export const AB_BRACKETS = [
  abRow(0, 6000000, 800, '$0 $60,000 8% Footnote 2'),
  abRow(6000000, 15123400, 1000, '$60,000.01 $151,234 10%'),
  abRow(15123400, 18148100, 1200, '$151,234.01 $181,481 12%'),
  abRow(18148100, 24197400, 1300, '$181,481.01 $241,974 13%'),
  abRow(24197400, 36296100, 1400, '$241,974.01 $362,961 14%'),
  abRow(36296100, null, 1500, '$362,961.01 unlimited 15%'),
];
export const AB_NEW_BRACKET = f('8% on the first $60,000', 'A new Alberta tax bracket of 8% was added on July 1, 2025', LAST_YEAR);   // the CRA's table (and form AB428) still use 8% for the whole 2025 year
export const AB_BPA = f(2232300, 'Alberta Claim $22,323', `${DED}/line-30000-basic-personal-amount.html`);
// Alberta credits are worked out at the lowest Alberta rate, 8% (the rate box on the worksheet for line 61545 of form AB428).
export const AB_CREDIT_RATE = f(800, 'Alberta non-refundable tax credit rate × 8 %', `${PKG}/5009-d/5009-d-25e.pdf`);
// Alberta supplemental tax credit (line 61545): (credit amounts x 8% - $4,800) x 25%. $4,800 is 8% of $60,000, so it is 0 until credit amounts pass $60,000.
export const AB_SUPP_RULE = f('2% of the total amount of certain non-refundable tax credits that are more than $60,000', 'It is equal to 2% of the total amount of certain non-refundable tax credits that are more than $60,000', AB_INFO);
export const AB_SUPP_BASE = f(480000, 'Line 3 multiplied by the percentage from line 4= Base amount– 4,800.00', `${PKG}/5009-d/5009-d-25e.pdf`);
export const AB_SUPP_RATE = f(2500, 'Applicable rate × 25 %', `${PKG}/5009-d/5009-d-25e.pdf`);

export const MISSING = [
  'T4 box 24 (insurable earnings) and box 26 (CPP pensionable earnings) cap rules: no fetched page states them for 2025. The made-up incomes are below the EI maximum ($65,700) and the YMPE, so each box equals box 14.',
  'Federal basic personal amount between $177,882 and $253,414 of net income: only "use the Federal Worksheet" is on the page. Not needed for these people; returnFor throws if net income is in that range.',
  'The Top-up tax credit line 1 ("amount from line 33800") was not defined on a fetched page in words; the amounts here are far below $8,319.38 whichever way it is read.',
];
