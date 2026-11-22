// Payroll deductions for Alberta, monthly pay (P = 12), basic claims only (TD1 / TD1AB claim code 1).
// Source: CRA T4127 Payroll Deductions Formulas, 122nd edition, effective January 1, 2026
// https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html
// Constants and formulas were read from that page on 2026-10-22. Section references are to T4127 chapters and tables.
// Pure functions, no I/O. Everything is integer cents; fractions are carried as numerator/denominator and rounded once,
// half up to the cent, so there is no floating point anywhere. T4127 Chapter 1 "Rounding procedures": tax, CPP/CPP2 and EI
// results are rounded to the nearest cent (a third decimal of 5 or more rounds up); rate ratios are never rounded.

const P = 12;                                    // T4127 Ch. 4 Step 1: monthly pay periods in the year

// ---- CPP / CPP2 (Chapter 6; Tables 8.3 to 8.6) ----
const CPP_RATE = 595;                            // 0.0595 as a count of 1/10000 (Table 8.3)
const CPP_BASE_RATE = 495;                       // 0.0495 base part (Table 8.4); the other 0.0100 is the first additional part (Table 8.5)
const CPP_EXEMPTION_MONTHLY = 29166;             // $3,500 / 12 = $291.66: Chapter 1 drops the third decimal of the basic exemption (Table 6.1, monthly)
export const CPP_EXEMPTION_ANNUAL = 350000;             // $3,500 basic exemption for a whole year (annualIncomeTax)
export const CPP_MAX = 423045;                         // $4,230.45 maximum employee contribution (Table 8.3; Chapter 6 formula C (i))
const CPP_BASE_MAX = 351945;                     // $3,519.45 maximum base contribution (Table 8.4; used in K2)
export const YMPE = 7460000;                            // $74,600.00 (Table 8.3; Chapter 6 factor W)
const CPP2_RATE = 4;                             // 0.04 of pensionable earnings between YMPE and YAMPE (Table 8.6), as a count of 1/100
const CPP2_MAX = 41600;                          // $416.00 maximum CPP2 contribution (Table 8.6; YAMPE $85,000 - YMPE $74,600 = $10,400 x 4%)

// ---- EI (Chapter 7; Table 8.7) ----
const EI_RATE = 163;                             // 0.0163, Canada except Quebec (Table 8.7), as a count of 1/10000
const EI_MAX = 112307;                           // $1,123.07 maximum employee premium (Table 8.7; maximum insurable earnings $68,900)

// ---- Federal tax (Chapter 4 Steps 2 and 3; Table 8.1 "Federal"; Table 8.2) ----
// [lower bound of A in cents, R in 1/10000, K in cents]
const FED = [[0, 1400, 0], [5852300, 2050, 380400], [11704500, 2600, 1024100], [18144000, 2900, 1568500], [25848200, 3300, 2602400]];
const FED_LOWEST = 14;                           // K1, K2, K4 use the lowest federal rate 0.14 (Chapter 4 Step 2), as a count of 1/100
const TC = 1645200;                              // BPAF $16,452: claim code 1 (Table 8.9: TC $16,452.00, K1 $2,303.28); no TD1 income-based reduction below $181,440
const CEA = 150100;                              // Canada employment amount $1,501 (Table 8.2); K4 = lesser of 0.14 x A and 0.14 x CEA (Step 2)

// ---- Alberta tax (Chapter 4 Steps 4 and 5; Table 8.1 "AB"; Table 8.2) ----
const AB = [[0, 800, 0], [6120000, 1000, 122400], [15425900, 1200, 430900], [18511100, 1300, 616000], [24681300, 1400, 862800], [37022000, 1500, 1233100]];
const AB_LOWEST = 8;                             // K1P and K2P use the lowest Alberta rate 0.08 (Step 5, Alberta), as a count of 1/100
const TCP = 2276900;                             // TCP $22,769 = Alberta basic personal amount (Step 5, Alberta; Table 8.10 claim code 1: TCP $22,769.00, K1P $1,821.52)
const AB_K5P_THRESHOLD = 489600;                 // K5P = ((K1P + K2P) - $4,896.00) x 0.25, not below 0 (Step 5, Alberta)

const rnd = (num, den) => Math.floor((2 * num + den) / (2 * den));   // num/den to the nearest cent, half up (num >= 0, den > 0)
const clamp0 = (n) => (n < 0 ? 0 : n);

// Chapter 6: C, the CPP contribution this period (cents). d = year-to-date CPP before this period.
export const cppFor = (gross, d) => clamp0(Math.min(CPP_MAX - d, rnd(CPP_RATE * clamp0(gross - CPP_EXEMPTION_MONTHLY), 10000)));
// Chapter 6: C2, the CPP2 contribution this period. W = greater of year-to-date pensionable income and YMPE x (PM/12), PM = 12.
export const cpp2For = (gross, ytdGross, d2) => clamp0(Math.min(CPP2_MAX - d2, rnd(CPP2_RATE * clamp0(ytdGross + gross - Math.max(ytdGross, YMPE)), 100)));
// Chapter 7: EI premium this period. d1 = year-to-date EI before this period.
export const eiFor = (gross, d1) => clamp0(Math.min(EI_MAX - d1, rnd(EI_RATE * gross, 10000)));

const bracket = (table, a) => table.findLast((row) => a >= row[0]);

// K2 / K2P, the CPP and EI credit, at `rate` (the lowest rate, as a count of 1/100): rate x (P x C x (0.0495/0.0595), max $3,519.45) + rate x (P x EI, max $1,123.07).
// Chapter 4 Step 2 note: in the period the annual maximum is reached, and after it, use the employee's maximum annual contribution or premium.
// Both parts are summed over one denominator and rounded once.
function k2(rate, c, ei, cppDone, eiDone) {
  const base595 = cppDone ? CPP_BASE_MAX * 595 : Math.min(P * c * CPP_BASE_RATE, CPP_BASE_MAX * 595);   // x 1/595 of a cent
  const eiCents = eiDone ? EI_MAX : Math.min(P * ei, EI_MAX);
  return rnd(rate * (base595 + eiCents * 595), 100 * 595);
}

// Pay stub for one pay period. ytd: totals BEFORE this period this calendar year, in cents { gross, cpp, cpp2, ei } (tax and net optional).
export function payStub({ grossCents, period, ytd = {} }) {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0) throw new RangeError('grossCents must be a non-negative integer');
  if (!Number.isInteger(period) || period < 1 || period > P) throw new RangeError('period must be 1..12');
  const y = { gross: ytd.gross ?? 0, cpp: ytd.cpp ?? 0, cpp2: ytd.cpp2 ?? 0, ei: ytd.ei ?? 0, federalTax: ytd.federalTax ?? 0, albertaTax: ytd.albertaTax ?? 0, net: ytd.net ?? 0 };
  const I = grossCents;

  const cpp = cppFor(I, y.cpp);
  const cpp2 = cpp2For(I, y.gross, y.cpp2);
  const ei = eiFor(I, y.ei);

  // Step 1: A = P x (I - F5A), F5A = F5 (no bonus, B = 0); F5 = C x (0.0100/0.0595) + C2 (the first additional part and CPP2 are deductible).
  const f5 = rnd(cpp * (CPP_RATE - CPP_BASE_RATE), CPP_RATE) + cpp2;
  const A = clamp0(P * (I - f5));

  const cppDone = y.cpp + cpp >= CPP_MAX;
  const eiDone = y.ei + ei >= EI_MAX;

  // Steps 2 and 3: T1 = T3 = (R x A) - K - K1 - K2 - K3 - K4, not below 0 (K3 = 0, LCF = 0).
  const [, R, K] = bracket(FED, A);
  const k1 = rnd(FED_LOWEST * TC, 100);
  const k2f = k2(FED_LOWEST, cpp, ei, cppDone, eiDone);
  const k4 = rnd(FED_LOWEST * Math.min(P * I, CEA), 100);
  const t3 = clamp0(rnd(clamp0(R * A - 10000 * (K + k1 + k2f + k4)), 10000));

  // Steps 4 and 5 (Alberta): T2 = T4 = (V x A) - KP - K1P - K2P - K3P - K4P - K5P, not below 0 (V1 = V2 = S = LCP = 0).
  const [, V, KP] = bracket(AB, A);
  const k1p = rnd(AB_LOWEST * TCP, 100);
  const k2p = k2(AB_LOWEST, cpp, ei, cppDone, eiDone);
  const k5p = clamp0(rnd(25 * (k1p + k2p - AB_K5P_THRESHOLD), 100));
  const t2 = clamp0(rnd(clamp0(V * A - 10000 * (KP + k1p + k2p + k5p)), 10000));

  // T = (T1 + T2) / P; shown separately, each rounded to the cent.
  const federalTax = rnd(t3, P);
  const albertaTax = rnd(t2, P);
  const net = I - cpp - cpp2 - ei - federalTax - albertaTax;
  return {
    gross: I, cpp, cpp2, ei, federalTax, albertaTax, net,
    ytd: { gross: y.gross + I, cpp: y.cpp + cpp, cpp2: y.cpp2 + cpp2, ei: y.ei + ei, federalTax: y.federalTax + federalTax, albertaTax: y.albertaTax + albertaTax, net: y.net + net },
  };
}

// ---- The employer's share (wave 4b: a student company pays it from its treasury on top of the gross) ----
// CPP: the employer contributes the same amount as the employee (CRA, "CPP contribution rates, maximums and exemptions": the rate is what "both the
// employer and employee contribute"; https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html,
// read 2026-10-23). The match includes CPP2 (employers match the second additional contribution too; that page does not say it, so it is the
// CRA's CPP2 guidance as we understand it, not read from a page). EI: the employer's premium is 1.4 x the employee's (CRA, "EI premium rates and
// maximums": "The employer's premium will be 1.4 times this amount", 2026 maximums $1,123.07 employee / $1,572.30 employer;
// https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html, read 2026-10-23).
const EMPLOYER_EI_X10 = 14;
export const employerShare = (stub) => ({ cpp: stub.cpp + stub.cpp2, ei: rnd(stub.ei * EMPLOYER_EI_X10, 10) });

// ---- Annual tax, for the Exchange's RRSP refund (docs/phase3.md wave 3b) ----
// Federal + Alberta income tax for a year, from the same constants as payStub, with the T4127 credits worked out on annual amounts: the basic personal amounts (K1, K1P), the
// Canada employment amount (K4), CPP and EI at the annual rates (K2, K2P), the enhanced CPP deduction and CPP2 (F5), and Alberta's K5P. `taxableCents` is the income the brackets
// apply to; `earnedCents` (default the same) is the employment income CPP, EI and the employment amount are charged on. They differ when an RRSP deduction or withdrawal moves
// taxable income but not pay: the RRSP changes `taxableCents` only. Pure: no I/O, integer cents, rounded half up per component like payStub. Ignores the federal basic personal
// amount's reduction above $181,440 (a student cannot reach it) and the credits a TD1 would add.
export function annualIncomeTax(taxableCents, earnedCents = taxableCents) {
  if (!Number.isSafeInteger(taxableCents) || taxableCents < 0 || !Number.isSafeInteger(earnedCents) || earnedCents < 0) throw new RangeError('income must be a non-negative integer of cents');
  const cpp = Math.min(CPP_MAX, rnd(CPP_RATE * clamp0(Math.min(earnedCents, YMPE) - CPP_EXEMPTION_ANNUAL), 10000));
  const cpp2 = Math.min(CPP2_MAX, rnd(CPP2_RATE * clamp0(earnedCents - YMPE), 100));
  const ei = Math.min(EI_MAX, rnd(EI_RATE * earnedCents, 10000));
  const A = clamp0(taxableCents - (rnd(cpp * (CPP_RATE - CPP_BASE_RATE), CPP_RATE) + cpp2));
  const k2 = (rate) => rnd(rate * (cpp * CPP_BASE_RATE + ei * CPP_RATE), 100 * CPP_RATE);   // rate x (base CPP + EI), one rounding

  const [, R, K] = bracket(FED, A);
  const fed = clamp0(rnd(clamp0(R * A - 10000 * (K + rnd(FED_LOWEST * TC, 100) + k2(FED_LOWEST) + rnd(FED_LOWEST * Math.min(earnedCents, CEA), 100))), 10000));

  const [, V, KP] = bracket(AB, A);
  const k1p = rnd(AB_LOWEST * TCP, 100), k2p = k2(AB_LOWEST);
  const k5p = clamp0(rnd(25 * (k1p + k2p - AB_K5P_THRESHOLD), 100));
  const ab = clamp0(rnd(clamp0(V * A - 10000 * (KP + k1p + k2p + k5p)), 10000));
  return fed + ab;
}

// ---- OAS recovery tax ("clawback"), for the year-end settlement of retirement income (docs/phase5-life.md 5c) ----
// Service Canada, "OAS pension recovery tax": repay 15% of net income above the threshold, up to the OAS received. 2026 income year threshold $95,323
// (marked an estimate on the page, final in October), read 2026-10-29:
// https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/recovery-tax.html
export const OAS_RECOVERY_THRESHOLD = 9532300;
const OAS_RECOVERY_PCT = 15;
// netIncomeCents: the year's net income (taxable income); oasCents: OAS received that year; thresholdCents: the threshold (the caller indexes it).
export function oasRecoveryTax(netIncomeCents, oasCents, thresholdCents = OAS_RECOVERY_THRESHOLD) {
  if (![netIncomeCents, oasCents, thresholdCents].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new RangeError('amounts must be non-negative integers of cents');
  return Math.min(oasCents, rnd(OAS_RECOVERY_PCT * clamp0(netIncomeCents - thresholdCents), 100));
}
