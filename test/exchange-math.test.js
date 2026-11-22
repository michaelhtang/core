// exchange: the price model and the order math, pure (no database). The module tests live in exchange.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hash32, mulberry32, zFor, monthStep, rateFactor, growth, expectedBp, doublingYears, microToCents } from '../modules/exchange/prices.js';
import { sides, costCents, proceedsCents, unitsForCents, basisShare, dividendCents, dividendPerUnit, sizeProblem, restsOffMarket, crosses, yearOf, tfsaRoom, rrspRoom, rrspWithheld, rrspSettle, rrspCompare } from '../modules/exchange/orders.js';
import { SECURITIES, FUNDS, STOCKS, EMPLOYERS, SPREAD_BP, PRICE_SCALE, UNIT, TFSA_LIMIT_CENTS, MER_BP, RRSP_LIMIT_CENTS } from '../modules/exchange/constants.js';

const start = () => Object.fromEntries(SECURITIES.map((s) => [s.ticker, s.startMicro]));
const series = (worldId, months, extra = {}) => {
  let prev = start();
  const out = [];
  for (let m = 2; m <= months + 1; m++) { const r = monthStep({ worldId, month: m, prev, securities: SECURITIES, ...extra }); prev = r.price; out.push(r); }
  return out;
};

test('the generator: FNV-1a and mulberry32 are the published algorithms, draws are normal', () => {
  assert.equal(hash32('a'), 0xe40c292c);                                  // FNV-1a 32-bit of "a"
  assert.equal(hash32(''), 0x811c9dc5);
  const r = mulberry32(1);
  const first = [r(), r(), r()];
  const again = mulberry32(1);
  assert.deepEqual(first, [again(), again(), again()]);
  assert.ok(first.every((x) => x >= 0 && x < 1));
  const zs = Array.from({ length: 20000 }, (_, i) => zFor(1, 'DAAX', i + 1));
  const mean = zs.reduce((a, b) => a + b, 0) / zs.length, sd = Math.sqrt(zs.reduce((a, b) => a + (b - mean) ** 2, 0) / zs.length);
  assert.ok(Math.abs(mean) < 0.03, `mean ${mean}`);
  assert.ok(Math.abs(sd - 1) < 0.03, `sd ${sd}`);
  assert.ok(zs.every((z) => Math.abs(z) <= 3.5));
});

test('determinism: the same world gives the same series; a different world differs; the draw depends on world, ticker and month', () => {
  assert.deepEqual(series(7, 36).map((r) => r.price), series(7, 36).map((r) => r.price));
  assert.notDeepEqual(series(7, 12).at(-1).price, series(8, 12).at(-1).price);
  assert.equal(zFor(3, 'AGRA', 5), zFor(3, 'AGRA', 5));
  assert.notEqual(zFor(3, 'AGRA', 5), zFor(3, 'AGRA', 6));
  assert.notEqual(zFor(3, 'AGRA', 5), zFor(3, 'BEAC', 5));
  assert.notEqual(zFor(3, 'AGRA', 5), zFor(4, 'AGRA', 5));
});

test('stocks share a market factor: the correlation of their draws is about 0.6, the bond fund is independent, the index fund is the market', () => {
  const N = 6000, corr = (xs, ys) => {
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    return sxy / Math.sqrt(sxx * syy);
  };
  // The monthly log return of each security is an affine function of its z, so recover z from the step with a fixed price and no fees.
  const zOf = (tk, m) => { const sec = SECURITIES.find((s) => s.ticker === tk); const r = monthStep({ worldId: 1, month: m, prev: { [tk]: 1e9 }, securities: [{ ...sec, merBp: 0 }] }).price[tk]; return Math.log(r / 1e9) - 0; };
  const ms = Array.from({ length: N }, (_, i) => i + 2);
  const a = ms.map((m) => zOf('AGRA', m)), b = ms.map((m) => zOf('CALL', m)), x = ms.map((m) => zOf('DAAX', m)), bond = ms.map((m) => zOf('DAAB', m));
  assert.ok(Math.abs(corr(a, b) - 0.6) < 0.05, `stock-stock ${corr(a, b)}`);
  assert.ok(Math.abs(corr(a, x) - Math.sqrt(0.6)) < 0.05, `stock-index ${corr(a, x)}`);
  assert.ok(Math.abs(corr(a, bond)) < 0.05, `stock-bond ${corr(a, bond)}`);
  // and the fund compounds where the guidelines put it: the mean monthly log growth, annualised, is ln(1 + mu), so the typical year returns mu
  const dx = SECURITIES.find((s) => s.ticker === 'DAAX');
  const logs = ms.map((m) => Math.log(growth({ ...dx }, zFor(1, 'MKT', m))));
  const cagr = Math.exp((logs.reduce((p, q) => p + q) / logs.length) * 12) - 1;
  assert.ok(Math.abs(cagr - dx.muBp / 10000) < 0.015, `compound ${cagr}`);
  assert.ok(Math.abs(growth({ muBp: 630, sigmaBp: 1500 }, 0) ** 12 - 1.063) < 1e-12);   // z = 0: exactly the cited compound rate
});

test('the seed secret: same secret, same series; another secret, another series; no secret keeps the plain seed', () => {
  const run = (secret) => { let prev = Object.fromEntries(SECURITIES.map((q) => [q.ticker, q.startMicro])); for (let m = 2; m <= 13; m++) prev = monthStep({ worldId: 1, secret, month: m, prev, securities: SECURITIES }).price; return prev; };
  assert.deepEqual(run('a1'), run('a1'));
  assert.notDeepEqual(run('a1'), run('b2'));
  assert.notDeepEqual(run('a1'), run(''));
  assert.equal(zFor(3, 'AGRA', 5, ''), zFor(3, 'AGRA', 5));
});

test('prices are integers of micro-cents (four digits below the cent), shown to the cent; they never fall below one cent', () => {
  const s = series(5, 24);
  for (const r of s) for (const v of Object.values(r.price)) assert.ok(Number.isSafeInteger(v) && v >= PRICE_SCALE);
  const sub = Object.values(s[0].price).filter((v) => v % PRICE_SCALE !== 0);
  assert.ok(sub.length >= 8, 'most prices carry sub-cent digits');
  assert.equal(microToCents(100_123_456), 10012);                            // $100.1235 shows as $100.12
  assert.equal(microToCents(100_125_000), 10013);
  const tiny = monthStep({ worldId: 1, month: 2, prev: { AGRA: 1 }, securities: STOCKS });
  assert.equal(tiny.price.AGRA, PRICE_SCALE);
});

test('MER drag: a fee of MER/12 comes off the price each month, exactly', () => {
  const sec = FUNDS[0];
  const p = 123_456_789;
  const free = monthStep({ worldId: 2, month: 3, prev: { DAAX: p }, securities: [{ ...sec, merBp: 0 }] }).price.DAAX;
  const fee = monthStep({ worldId: 2, month: 3, prev: { DAAX: p }, securities: [{ ...sec, merBp: 120 }] }).price.DAAX;
  assert.ok(Math.abs(fee - free * (1 - 0.012 / 12)) <= 1, `${fee} vs ${free * 0.999}`);   // 1.20% a year = 0.10% this month
  assert.ok(MER_BP.DAAG > MER_BP.DAAX, 'the balanced fund costs more than the index');
  // over 30 years the same 1.2% a year costs about 30% of the pot
  assert.ok(Math.abs((1 - 0.012 / 12) ** 360 - 0.698) < 0.005);
});

test('the bond fund falls duration x the policy change; the index and stocks do not feel it; the balanced fund feels 40% of it', () => {
  assert.equal(rateFactor(7, 25), 1 - 0.0175);
  assert.equal(rateFactor(7, -50), 1.035);
  assert.equal(rateFactor(7, 100000), 0.5);                                   // never below half
  const prev = { DAAX: 1e8, DAAB: 1e8, DAAG: 1e8, AGRA: 5e7 };
  const secs = SECURITIES.filter((s) => prev[s.ticker]);
  const flat = monthStep({ worldId: 4, month: 6, prev, securities: secs }).price, up = monthStep({ worldId: 4, month: 6, prev, securities: secs, policyDeltaBp: 100 }).price;
  assert.ok(Math.abs(up.DAAB / flat.DAAB - 0.93) < 1e-6);
  assert.equal(up.DAAX, flat.DAAX); assert.equal(up.AGRA, flat.AGRA);
  assert.ok(Math.abs(up.DAAG / flat.DAAG - (1 - 0.4 * 0.07)) < 1e-3);
});

test('market events: crash -25% equities and -5% bonds, scandal and boom hit one stock, and the circuit breaker', () => {
  const prev = start();
  const calm = monthStep({ worldId: 9, month: 4, prev, securities: SECURITIES });
  const crash = monthStep({ worldId: 9, month: 4, prev, securities: SECURITIES, events: [{ kind: 'crash' }] });
  for (const t of ['DAAX', 'AGRA', 'CALL']) assert.ok(Math.abs(crash.price[t] / calm.price[t] - 0.75) < 1e-6, t);
  assert.ok(Math.abs(crash.price.DAAB / calm.price.DAAB - 0.95) < 1e-6);
  assert.ok(Math.abs(crash.price.DAAG / calm.price.DAAG - (0.6 * 0.75 + 0.4 * 0.95)) < 0.02);
  const corr = monthStep({ worldId: 9, month: 4, prev, securities: SECURITIES, events: [{ kind: 'correction' }] });
  assert.ok(Math.abs(corr.price.MAPL / calm.price.MAPL - 0.9) < 1e-6 && corr.price.DAAB === calm.price.DAAB);
  const sc = monthStep({ worldId: 9, month: 4, prev, securities: SECURITIES, events: [{ kind: 'scandal', ticker: 'KEYS' }, { kind: 'boom', ticker: 'PRAI' }] });
  assert.ok(Math.abs(sc.price.KEYS / calm.price.KEYS - 0.65) < 1e-6 && Math.abs(sc.price.PRAI / calm.price.PRAI - 1.25) < 1e-6);
  assert.equal(sc.price.AGRA, calm.price.AGRA);
  // breaker: a crash pauses the stocks and the index fund, not the bonds; a scandal (-35%) passes through; an ordinary month pauses only a stock whose normal move is over 20%
  for (const t of ['DAAX', 'AGRA', 'CALL', 'KEYS']) assert.equal(crash.halted[t], true, t);
  assert.equal(crash.halted.DAAB, false);
  assert.equal(sc.halted.KEYS === calm.halted.KEYS, true);                    // the scandal itself changes nothing about the pause
  const wild = [{ ...STOCKS[0], sigmaBp: 20000 }];
  let hit = 0; for (let m = 2; m < 60; m++) if (monthStep({ worldId: 1, month: m, prev: { AGRA: 1e9 }, securities: wild }).halted.AGRA) hit++;
  assert.ok(hit > 10, `a 200% volatility stock halts often (${hit})`);
  let tame = 0; for (let m = 2; m < 2000; m++) if (monthStep({ worldId: 1, month: m, prev: { DAAX: 1e9 }, securities: [FUNDS[0]] }).halted.DAAX) tame++;
  assert.equal(tame, 0, 'the index fund does not halt in an ordinary month');
});

test('the catalogue: fund returns come from the FP Canada guidelines, stocks are named after the Job Centre employers', () => {
  assert.equal(FUNDS.find((f) => f.ticker === 'DAAX').muBp, 630);
  assert.equal(FUNDS.find((f) => f.ticker === 'DAAB').muBp, 320);
  assert.equal(FUNDS.find((f) => f.ticker === 'DAAB').durationYears, 7);
  assert.equal(TFSA_LIMIT_CENTS, 700000);
  assert.equal(STOCKS.length, 8);
  for (const s of STOCKS) {
    assert.ok(EMPLOYERS.has(s.name), `${s.name} is a Job Centre employer`);
    assert.ok(s.sigmaBp >= 2500 && s.sigmaBp <= 4500, `${s.ticker} volatility 25-45%`);
    assert.ok(s.yieldBp >= 0 && s.yieldBp <= 400, `${s.ticker} yield 0-4%`);
  }
  assert.equal(new Set(SECURITIES.map((s) => s.ticker)).size, SECURITIES.length);
  const dax = SECURITIES.find((s) => s.ticker === 'DAAX'), dag = SECURITIES.find((s) => s.ticker === 'DAAG');
  assert.equal(expectedBp(dax, SECURITIES), 630 - 6);
  assert.equal(expectedBp(dag, SECURITIES), 0.6 * 630 + 0.4 * 320 - 20);
  assert.ok(Math.abs(doublingYears(624) - 11.54) < 0.01);
  assert.equal(doublingYears(0), null);
});

test('spread math: ask rounds up, bid rounds down, to the micro-cent', () => {
  assert.deepEqual(sides(100_000_000, SPREAD_BP.fund), { ask: 100_100_000, bid: 99_900_000 });     // $100.00: $100.10 / $99.90
  assert.deepEqual(sides(42_000_000, SPREAD_BP.stock), { ask: 42_210_000, bid: 41_790_000 });      // 1% spread: +-0.5%
  assert.deepEqual(sides(33_333_333, 20), { ask: 33_366_667, bid: 33_299_999 });                    // 33.333333 x 1.001 = 33.3666663 up, x 0.999 = 33.2999997 down
  const { ask, bid } = sides(77_777_777, 100);
  assert.ok(ask > 77_777_777 && bid < 77_777_777);
});

test('buy cost rounds up to the cent, sale proceeds round down, and the spread is a cost both ways', () => {
  assert.equal(costCents(UNIT, 100_100_000), 10010);                                                // one whole unit at $100.10
  assert.equal(costCents(100, 100_100_000), 2);                                                     // 0.0001 unit = 1.001 cents rounds UP to 2
  assert.equal(proceedsCents(100, 99_900_000), 0);                                                  // 0.999 cents rounds DOWN to 0
  assert.equal(proceedsCents(UNIT, 99_900_000), 9990);
  assert.equal(costCents(3 * UNIT, 42_210_000), 12663);                                             // exact
  assert.equal(costCents(1, 1), 1);                                                                 // anything positive costs at least a cent
  // round trip with the spread: buy then sell the same units never makes money
  for (const [u, p] of [[123456, 98765432], [7 * UNIT, 41_790_000], [999900, 100_000_000], [UNIT, 19_000_001]]) {
    const { ask, bid } = sides(p, 20);
    assert.ok(proceedsCents(u, bid) <= costCents(u, ask));
  }
  // no overflow: 10,000 units at $5,000 is 5e13 micro-units-times-micro-cents / 1e10 = 5,000,000,000 cents... computed exactly in BigInt
  assert.equal(costCents(10_000 * UNIT, 5_000 * 100 * PRICE_SCALE), 5_000_000_000);
});

test('dollars to units for a fund: whole steps of 0.0001, and the cost never goes over the dollars given', () => {
  assert.equal(unitsForCents(5000, 100_100_000, 100), 499500);
  assert.ok(costCents(499500, 100_100_000) <= 5000);
  let seed = 1; const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let i = 0; i < 2000; i++) {
    const cents = 1 + rnd(5_000_000), ask = 1_000_000 + rnd(900_000_000), u = unitsForCents(cents, ask, 100);
    assert.equal(u % 100, 0);
    assert.ok(costCents(u, ask) <= cents, `${cents} ${ask}`);
    assert.ok(costCents(u + 100, ask) > cents, 'and it is the most that fits');
  }
  assert.equal(unitsForCents(1, 100_100_000, 100), 0);                                              // a cent buys nothing of a $100 fund
  assert.equal(sizeProblem('stock', 1_500_000, UNIT), 'Stocks trade in whole shares');
  assert.equal(sizeProblem('stock', 2 * UNIT, UNIT), null);
  assert.equal(sizeProblem('fund', 150, 100), 'Funds trade in steps of 0.0001 of a unit');
  assert.equal(sizeProblem('fund', 100, 100), null);
  assert.ok(sizeProblem('fund', 0, 100) && sizeProblem('fund', -100, 100) && sizeProblem('fund', 1.5, 1));
});

test('limit orders: they must rest off the market, and fill only when the market crosses them', () => {
  const bid = 99_000_000, ask = 101_000_000;
  assert.equal(restsOffMarket('buy', 100_000_000, bid, ask), true);
  assert.equal(restsOffMarket('buy', 101_000_000, bid, ask), false);                                // at the ask is a market order
  assert.equal(restsOffMarket('sell', 100_000_000, bid, ask), true);
  assert.equal(restsOffMarket('sell', 99_000_000, bid, ask), false);
  assert.equal(crosses('buy', 100_000_000, 98_000_000, 100_000_001), false);                         // ask still above the limit
  assert.equal(crosses('buy', 100_000_000, 98_000_000, 100_000_000), true);                          // at the limit
  assert.equal(crosses('buy', 100_000_000, 90_000_000, 95_000_000), true);                           // better than the limit
  assert.equal(crosses('sell', 100_000_000, 99_999_999, 105_000_000), false);
  assert.equal(crosses('sell', 100_000_000, 100_000_000, 105_000_000), true);
});

test('cost basis, dividends', () => {
  assert.equal(basisShare(10000, 3 * UNIT, UNIT), 3333);                                            // a third, floored
  assert.equal(basisShare(10000, 3 * UNIT, 3 * UNIT), 10000);                                       // all of it when everything goes
  assert.equal(dividendPerUnit(100_000_000, 400), 1_000_000);                                       // 4% a year, a quarter: 1% of $100 = $1.00 (1e6 micro-cents = 100 cents? no: 1e6 micro-cents = 100 cents)
  assert.equal(dividendCents(10 * UNIT, 100_000_000, 400), 1000);                                    // ten shares of a $100 stock at 4%: $10.00 a quarter
  assert.equal(dividendCents(UNIT, 31_000_000, 350), 27);                                           // 0.875% of $31 = $0.27125 -> floored
  assert.equal(dividendCents(UNIT, 31_000_000, 0), 0);
});

test('TFSA room: $7,000 a year, unused room carries forward, a withdrawal comes back only in the next world year', () => {
  assert.equal(yearOf(1), 1); assert.equal(yearOf(12), 1); assert.equal(yearOf(13), 2); assert.equal(yearOf(25), 3);
  assert.equal(tfsaRoom(1, []), 700000);
  assert.equal(tfsaRoom(1, [{ year: 1, contributed: 500000, withdrawn: 0 }]), 200000);
  assert.equal(tfsaRoom(2, []), 1400000);                                                           // carry-forward of the unused year 1
  assert.equal(tfsaRoom(2, [{ year: 1, contributed: 700000, withdrawn: 0 }]), 700000);
  assert.equal(tfsaRoom(1, [{ year: 1, contributed: 700000, withdrawn: 300000 }]), 0);              // the withdrawal does NOT restore room this year
  assert.equal(tfsaRoom(2, [{ year: 1, contributed: 700000, withdrawn: 300000 }]), 1000000);          // 7,000 new + 3,000 back
  assert.equal(tfsaRoom(3, [{ year: 1, contributed: 700000, withdrawn: 300000 }, { year: 2, contributed: 1000000, withdrawn: 0 }]), 700000 * 3 - 1700000 + 300000);
  assert.equal(tfsaRoom(1, [{ year: 1, contributed: 900000, withdrawn: 0 }]), 0);                    // never negative
});

test('RRSP room: 18% of last year\'s earned income up to $33,810, none in year 1, unused room carries forward, withdrawals never appear', () => {
  assert.equal(RRSP_LIMIT_CENTS, 3381000);
  assert.equal(rrspRoom(1, {}, 0), 0);                                                              // year 1: there is no last year
  assert.equal(rrspRoom(1, { 1: 4800000 }, 0), 0);                                                  // this year's pay only counts next year
  assert.equal(rrspRoom(2, { 1: 4800000 }, 0), 864000);                                             // 18% of $48,000
  assert.equal(rrspRoom(2, { 1: 4800000 }, 864000), 0);
  assert.equal(rrspRoom(2, { 1: 30000000 }, 0), 3381000);                                           // 18% of $300,000 is $54,000: the cap bites
  assert.equal(rrspRoom(2, { 1: 18783334 }, 0), 3381000); assert.equal(rrspRoom(2, { 1: 18783333 }, 0), 3380999);   // the cap, to the cent: 18% of $187,833.34 is $33,810.00
  assert.equal(rrspRoom(3, { 1: 4800000, 2: 4800000 }, 0), 1728000);                                // year 2's room carried into year 3
  assert.equal(rrspRoom(3, { 1: 4800000, 2: 5000000 }, 864000), 900000);
  assert.equal(rrspRoom(3, { 1: 4800000 }, 0), 864000);                                             // no pay in year 2: only year 1's room
  assert.equal(rrspRoom(2, { 1: 1000 }, 5000), 0);                                                  // never negative
});

test('RRSP withholding: 10% up to $5,000, 20% to $15,000, 30% above, on the whole of one withdrawal', () => {
  assert.equal(rrspWithheld(1), 0); assert.equal(rrspWithheld(100), 10);
  assert.equal(rrspWithheld(500000), 50000);                                                        // exactly $5,000: still 10%
  assert.equal(rrspWithheld(500001), 100000);                                                       // one cent over: 20% of the whole amount (100,000.2 rounds to 100,000)
  assert.equal(rrspWithheld(1500000), 300000);                                                      // exactly $15,000: still 20%
  assert.equal(rrspWithheld(1500001), 450000);                                                      // one cent over: 30%
  assert.equal(rrspWithheld(2500000), 750000);
  assert.equal(rrspWithheld(105), 11);                                                              // 10.5 rounds half up
});

test('RRSP settlement and the TFSA vs RRSP comparison', () => {
  assert.equal(rrspSettle(600000, 424000, 0), 176000);                                              // a contributor: tax saved
  assert.equal(rrspSettle(600000, 776000, 160000), -16000);                                         // a withdrawer: tax on the withdrawal less what was withheld
  const same = rrspCompare(100000, 630, 30, 2200, 2200), low = rrspCompare(100000, 630, 30, 2200, 1500), high = rrspCompare(100000, 630, 30, 2200, 3000);
  assert.ok(Math.abs(same.rrsp - same.tfsa) <= 1, 'equal tax rates: the two boxes tie when the refund is invested');
  assert.ok(low.rrsp > low.tfsa && high.rrsp < high.tfsa);
  assert.equal(same.tfsa, Math.round(100000 * 1.063 ** 30));
});
