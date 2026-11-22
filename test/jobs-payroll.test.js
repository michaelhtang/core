import test from 'node:test';
import assert from 'node:assert/strict';
import { payStub, annualIncomeTax } from '../modules/jobs/payroll.js';

// Expected values: HAND ARITHMETIC from CRA T4127 (122nd edition, January 1, 2026), Alberta, P = 12, claim code 1.
// They were NOT taken from PDOC (the CRA online calculator asks the user to accept a disclaimer first, which an automated
// run cannot do on anyone's behalf). TO DO: Mr. Tang compares at least one stub against PDOC (Alberta, monthly, 2026, claim code 1).
//
// Method for every case (T4127 Chapter 4 Option 1, Chapter 6 CPP, Chapter 7 EI; rounding per Chapter 1, half up to the cent):
//   C   = 0.0595 x (I - 291.66)        (the monthly basic exemption 3500/12 is truncated to 291.66)
//   EI  = 0.0163 x I
//   F5  = C x (0.0100/0.0595) + C2     A = 12 x (I - F5)
//   K1  = 0.14 x 16,452 = 2,303.28     K4 = 0.14 x min(12 I, 1,501) = 210.14
//   K2  = 0.14 x [min(12 x C x 0.0495/0.0595, 3,519.45) + min(12 x EI, 1,123.07)]
//   T3  = R x A - K - K1 - K2 - K4     federal = T3 / 12
//   K1P = 0.08 x 22,769 = 1,821.52     K2P = 0.08 x [same two minimums]     K5P = max(0, (K1P + K2P - 4,896) x 0.25) = 0
//   T4  = V x A - KP - K1P - K2P - K5P Alberta = T4 / 12
// All amounts below are cents; the dollar arithmetic is in the comments.
const CASES = [
  {
    name: '$1,500: below the tax thresholds, so no income tax',
    gross: 150000, ytd: {},
    // C = 0.0595 x (1,500.00 - 291.66) = 71.90 (71.8962);  EI = 0.0163 x 1,500 = 24.45;  F5 = 71.90 x 0.01/0.0595 = 12.08;  A = 12 x 1,487.92 = 17,855.04
    // K2 = 0.14 x (717.78 + 293.40) = 141.57;  T3 = 0.14 x 17,855.04 - 2,303.28 - 141.57 - 210.14 = -155.30, so 0.   K2P = 80.90;  T4 = 0.08 x 17,855.04 - 1,821.52 - 80.90 < 0, so 0
    // net = 1,500.00 - 71.90 - 24.45 = 1,403.65
    want: { gross: 150000, cpp: 7190, cpp2: 0, ei: 2445, federalTax: 0, albertaTax: 0, net: 140365 },
  },
  {
    name: '$2,600',
    gross: 260000, ytd: {},
    // C = 0.0595 x 2,308.34 = 137.35 (137.3462);  EI = 42.38;  F5 = 137.35 x 0.01/0.0595 = 23.08;  A = 12 x 2,576.92 = 30,923.04
    // K2 = 0.14 x (min(1,371.19, 3,519.45) + 508.56) = 191.97 + 71.20 = 263.17
    // T3 = 0.14 x 30,923.04 - 2,303.28 - 263.17 - 210.14 = 4,329.2256 - 2,776.59 = 1,552.64;  federal = 1,552.64 / 12 = 129.39 (129.3867)
    // K2P = 0.08 x (1,371.19 + 508.56) = 150.38;  T4 = 0.08 x 30,923.04 - 1,821.52 - 150.38 = 2,473.8432 - 1,971.90 = 501.94;  Alberta = 41.83 (41.8283)
    // net = 2,600.00 - 137.35 - 42.38 - 129.39 - 41.83 = 2,249.05
    want: { gross: 260000, cpp: 13735, cpp2: 0, ei: 4238, federalTax: 12939, albertaTax: 4183, net: 224905 },
  },
  {
    name: '$4,000',
    gross: 400000, ytd: {},
    // C = 0.0595 x 3,708.34 = 220.65 (220.6462);  EI = 65.20;  F5 = 220.65 x 0.01/0.0595 = 37.08;  A = 12 x 3,962.92 = 47,555.04
    // K2 = 0.14 x (2,202.79 + 782.40) = 308.39 + 109.54 = 417.93
    // T3 = 0.14 x 47,555.04 - 2,303.28 - 417.93 - 210.14 = 6,657.7056 - 2,931.35 = 3,726.36;  federal = 310.53 (310.5300)
    // K2P = 0.08 x (2,202.79 + 782.40) = 238.82;  T4 = 0.08 x 47,555.04 - 1,821.52 - 238.82 = 3,804.4032 - 2,060.34 = 1,744.06;  Alberta = 145.34 (145.3383)
    // net = 4,000.00 - 220.65 - 65.20 - 310.53 - 145.34 = 3,258.28
    want: { gross: 400000, cpp: 22065, cpp2: 0, ei: 6520, federalTax: 31053, albertaTax: 14534, net: 325828 },
  },
  {
    name: '$6,500: second federal bracket (20.5%) and second Alberta bracket (10%)',
    gross: 650000, ytd: {},
    // C = 0.0595 x 6,208.34 = 369.40 (369.3962);  EI = 105.95;  F5 = 369.40 x 0.01/0.0595 = 62.08;  A = 12 x 6,437.92 = 77,255.04
    // A is in the 20.5% federal bracket (58,523 to 117,045, K = 3,804) and the 10% Alberta bracket (61,200 to 154,259, KP = 1,224)
    // K2 = 0.14 x (min(3,687.79, 3,519.45) + min(1,271.40, 1,123.07)) = 0.14 x (3,519.45 + 1,123.07) = 492.72 + 157.23 = 649.95
    // T3 = 0.205 x 77,255.04 - 3,804 - 2,303.28 - 649.95 - 210.14 = 15,837.2832 - 6,967.37 = 8,869.91;  federal = 739.16 (739.1592)
    // K2P = 0.08 x 4,642.52 = 371.40;  T4 = 0.10 x 77,255.04 - 1,224 - 1,821.52 - 371.40 = 7,725.504 - 3,416.92 = 4,308.58;  Alberta = 359.05 (359.0483)
    // net = 6,500.00 - 369.40 - 105.95 - 739.16 - 359.05 = 4,926.44
    want: { gross: 650000, cpp: 36940, cpp2: 0, ei: 10595, federalTax: 73916, albertaTax: 35905, net: 492644 },
  },
  {
    name: '$9,000',
    gross: 900000, ytd: {},
    // C = 0.0595 x 8,708.34 = 518.15 (518.1462);  EI = 146.70;  F5 = 518.15 x 0.01/0.0595 = 87.08;  A = 12 x 8,912.92 = 106,955.04
    // K2 = 649.95 (both minimums hit their maximums);  T3 = 0.205 x 106,955.04 - 3,804 - 2,303.28 - 649.95 - 210.14 = 21,925.7832 - 6,967.37 = 14,958.41;  federal = 1,246.53 (1,246.5342)
    // T4 = 0.10 x 106,955.04 - 1,224 - 1,821.52 - 371.40 = 10,695.504 - 3,416.92 = 7,278.58;  Alberta = 606.55 (606.5483)
    // net = 9,000.00 - 518.15 - 146.70 - 1,246.53 - 606.55 = 6,482.07
    want: { gross: 900000, cpp: 51815, cpp2: 0, ei: 14670, federalTax: 124653, albertaTax: 60655, net: 648207 },
  },
  {
    name: 'December $6,500 with YTD gross $71,500: CPP reaches its maximum, CPP2 starts, EI is already maxed',
    // Eleven months of $6,500 (each C = 369.40, EI as above): YTD gross 71,500.00; YTD CPP 11 x 369.40 = 4,063.40; YTD EI capped at 1,123.07 (reached in November: 10 x 105.95 + 63.57)
    gross: 650000, ytd: { gross: 7150000, cpp: 406340, cpp2: 0, ei: 112307 },
    // C = min(4,230.45 - 4,063.40 = 167.05, 369.40) = 167.05
    // C2 = min(416.00 - 0, (71,500 + 6,500 - W) x 0.04) with W = max(71,500, 74,600) = 74,600:  (78,000 - 74,600) x 0.04 = 136.00
    // EI = min(1,123.07 - 1,123.07, 105.95) = 0
    // F5 = 167.05 x 0.01/0.0595 + 136.00 = 28.08 + 136.00 = 164.08;  A = 12 x (6,500.00 - 164.08) = 76,031.04
    // K2: CPP and EI are at their annual maximums, so T4127 Chapter 4 Step 2's note uses the maximums: 0.14 x (3,519.45 + 1,123.07) = 649.95
    // T3 = 0.205 x 76,031.04 - 3,804 - 2,303.28 - 649.95 - 210.14 = 15,586.3632 - 6,967.37 = 8,618.99;  federal = 718.25 (718.2492)
    // K2P = 371.40;  T4 = 0.10 x 76,031.04 - 1,224 - 1,821.52 - 371.40 = 7,603.104 - 3,416.92 = 4,186.18;  Alberta = 348.85 (348.8483)
    // net = 6,500.00 - 167.05 - 136.00 - 0 - 718.25 - 348.85 = 5,129.85
    want: { gross: 650000, cpp: 16705, cpp2: 13600, ei: 0, federalTax: 71825, albertaTax: 34885, net: 512985 },
  },
];

for (const c of CASES) {
  test(`payStub (T4127 by hand): ${c.name}`, () => {
    const s = payStub({ grossCents: c.gross, period: c.ytd.gross ? 12 : 1, ytd: c.ytd });
    const { ytd: _y, ...got } = s;
    assert.deepEqual(got, c.want);
    assert.equal(s.gross - s.cpp - s.cpp2 - s.ei - s.federalTax - s.albertaTax, s.net);
  });
}

test('payStub: year to date accumulates and the annual CPP / CPP2 / EI maximums are never exceeded', () => {
  let ytd = {};
  for (let m = 1; m <= 12; m++) ({ ytd } = payStub({ grossCents: 900000, period: m, ytd }));
  assert.equal(ytd.gross, 10800000);
  assert.equal(ytd.cpp, 423045);        // $4,230.45
  assert.equal(ytd.cpp2, 41600);        // $416.00 (YTD pensionable income passes YAMPE $85,000 in October)
  assert.equal(ytd.ei, 112307);         // $1,123.07
  assert.equal(ytd.net, ytd.gross - ytd.cpp - ytd.cpp2 - ytd.ei - ytd.federalTax - ytd.albertaTax);
});

test('payStub: bad input is refused', () => {
  assert.throws(() => payStub({ grossCents: -1, period: 1 }), RangeError);
  assert.throws(() => payStub({ grossCents: 1.5, period: 1 }), RangeError);
  assert.throws(() => payStub({ grossCents: 100, period: 13 }), RangeError);
});

test('annualIncomeTax (federal + Alberta, 2026): zero below the threshold, known points, and the marginal rate is the bracket rates', () => {
  assert.equal(annualIncomeTax(0), 0); assert.equal(annualIncomeTax(1000000), 0); assert.equal(annualIncomeTax(1500000), 0);   // $10,000 and $15,000: nothing to pay
  assert.ok(annualIncomeTax(2000000) > 0 && annualIncomeTax(2000000) < 20000);                                               // just over the federal threshold: a little federal tax, no Alberta tax
  // known points, pinned from the implementation and cross-checked against twelve pay stubs below ($20,000 / $48,000 / $100,000)
  assert.equal(annualIncomeTax(2000000), 10349); assert.equal(annualIncomeTax(4800000), 547043); assert.equal(annualIncomeTax(10000000), 1977198);
  // the year's tax agrees with twelve monthly pay stubs at $4,000 (each stub rounds its own month)
  let ytd = {}, paid = 0;
  for (let period = 1; period <= 12; period++) { const s = payStub({ grossCents: 400000, period, ytd }); ytd = s.ytd; paid += s.federalTax + s.albertaTax; }
  assert.ok(Math.abs(paid - annualIncomeTax(4800000)) <= 12, `${paid} vs ${annualIncomeTax(4800000)}`);
  // the next $1,000 of taxable income costs 14% federal + 8% Alberta = 22% (CPP and EI stay as earned: a deduction does not cut pay)
  for (const base of [3000000, 4800000, 5500000]) assert.ok(Math.abs(annualIncomeTax(base + 100000, base) - annualIncomeTax(base, base) - 22000) <= 2, `at ${base}`);
  // above $58,523 federal 20.5%, and above $61,200 Alberta 10%: 30.5%
  assert.ok(Math.abs(annualIncomeTax(6500000 + 100000, 6500000) - annualIncomeTax(6500000, 6500000) - 30500) <= 2);
  // if the pay itself goes up the CPP and EI credits move too, so the one-argument marginal rate is a little under the bracket rates
  const m = annualIncomeTax(4900000) - annualIncomeTax(4800000);
  assert.ok(m > 19000 && m < 22000, String(m));
  let last = 0;
  for (let x = 0; x <= 30000000; x += 50000) { const t = annualIncomeTax(x); assert.ok(t >= last, `monotonic at ${x}`); last = t; }
  assert.throws(() => annualIncomeTax(-1), RangeError); assert.throws(() => annualIncomeTax(1.5), RangeError);
});
