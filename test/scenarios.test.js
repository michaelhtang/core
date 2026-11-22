// life scenarios (docs/phase6-roles.md 1.4, "As built (6a feed + scenarios)"): the four scenarios in modules/life/scenarios.json validate under checkEvent, whose bounds
// are exactly the services' (a mismatch would jam the tick at the event's month); POST /api/life/scenario replaces only the unfired rows; fired scenario events call the
// real services in a full-config world and the tick does not fail; rates.setInflation and insurance.triggerEvent validate and are idempotent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkEvent, SCENARIOS } from '../modules/life/index.js';
import { endMonth } from '../modules/life/stages.js';
import { CONFIG, world, cleanupWorlds } from './app-world.js';

after(cleanupWorlds);
const END = endMonth();
const rowsOf = (w) => w.app.db.prepare('SELECT id, month, kind, args, headline, skip, fired_month, result FROM life_events WHERE world_id = ? ORDER BY id').all(w.app.world.current().id);
const failures = (w) => w.app.db.prepare('SELECT module, error FROM tick_failures').all();
const asEvent = (ev, from) => ({ month: from + ev.offset, kind: ev.kind, headline: ev.headline, ...ev.args });

test('scenarios.json: the four scenarios, offsets from 1, every row valid under checkEvent wherever the class starts it', () => {
  assert.deepEqual(SCENARIOS.map((s) => s.id), ['stable', '2008', '1981-alberta', '2022-inflation']);
  assert.deepEqual(SCENARIOS.map((s) => s.events.length), [0, 6, 4, 6]);
  assert.deepEqual(SCENARIOS.find((s) => s.id === '2008').events.map((e) => [e.offset, e.kind]), [[3, 'correction'], [6, 'crash'], [7, 'housing'], [8, 'rate'], [9, 'rate'], [14, 'rally']]);
  assert.equal(Math.max(...SCENARIOS.find((s) => s.id === '1981-alberta').events.filter((e) => e.kind === 'rate').map((e) => e.args.rate_bp)), 1000, 'capped at the policy maximum');
  for (const sc of SCENARIOS) {
    assert.ok(sc.name && sc.blurb, sc.id);
    for (const ev of sc.events) {
      assert.ok(ev.offset >= 1, `${sc.id}: offsets start at 1 (a row at the current month would fire late)`);
      for (const from of [1, 2, 100, END - 30]) if (from + ev.offset < END) assert.doesNotThrow(() => checkEvent(asEvent(ev, from), END), `${sc.id} +${ev.offset} from ${from}`);
    }
  }
});

test('checkEvent accepts exactly what the services accept (rate 0-1000, inflation 0-1000, housing +-5..15, insurance keys, town tickers, headline)', async () => {
  const w = await world({ n: 1 });
  const life = w.k('life');
  const call = (mod, svc, args) => { try { life.modules.call(mod, svc, args); return true; } catch (e) { if (e.status === 400) return false; throw e; } };
  const ok = (e) => { try { checkEvent({ month: 10, headline: 'x', ...e }, END); return true; } catch { return false; } };
  const table = [
    ['rate', 'rates', 'queueRate', 'rate_bp', 'rate_bp', [-1, 0, 1, 999, 1000, 1001, 1.5, '5', null, 2 ** 53]],
    ['inflation', 'rates', 'setInflation', 'inflation_bp', 'inflation_bp', [-1, 0, 210, 1000, 1001, 1.5, '5', null]],
    ['housing', 'housing', 'marketEvent', 'pct', 'pct', [-16, -15, -10, -5, -4, 0, 4, 5, 10, 15, 16, 7.5, '10', null]],
  ];
  for (const [kind, mod, svc, field, arg, values] of table) {
    for (const v of values) assert.equal(ok({ kind, [field]: v }), call(mod, svc, { [arg]: v }), `${kind} ${JSON.stringify(v)}`);
  }
  for (const event of ['phone-screen', 'car-repair', 'burst-pipe', 'laptop-theft', 'dental', 'tax-refund', 'nope', '', 5, null]) {
    assert.equal(ok({ kind: 'insurance', event }), call('insurance', 'triggerEvent', { event, scope: 'town' }), `insurance ${event}`);
  }
  // (exchange answers an event already queued this month before it looks at the ticker, so the refused tickers go first)
  for (const ticker of ['DAAX', 'agra', 'ZZZZ', '', null, 5, 'AGRA', 'BEAC', 'CORN', 'MAPL', 'PRAI', 'SPRK', 'CALL', 'KEYS']) {
    for (const kind of ['scandal', 'boom']) assert.equal(ok({ kind, ticker }), call('exchange', 'stageEvent', { kind, ticker, headline: 'x' }) , `${kind} ${ticker}`);
  }
  for (const kind of ['crash', 'correction', 'rally']) assert.equal(ok({ kind }), true);
  // a headline: whatever checkEvent accepts the service accepts (checkEvent is stricter about control characters, which the service turns into spaces)
  for (const headline of ['ok', 'x'.repeat(120), 'x'.repeat(121), '', '   ', 'a\nb', '\u0001', 'caf\u00e9 \u2014 ok']) {
    const mine = ok({ kind: 'crash', headline }), theirs = call('exchange', 'stageEvent', { kind: 'crash', headline });
    assert.ok(!mine || theirs, `headline ${JSON.stringify(headline)}`);
    if (!/[\u0000-\u001f]/.test(headline)) assert.equal(mine, theirs, `headline ${JSON.stringify(headline)}`);
  }
  for (const headline of [null, 5, {}]) assert.equal(ok({ kind: 'crash', headline }), false);
  assert.equal(ok({ kind: 'nope' }), false);
  assert.equal(ok({ kind: 'rate', rate_bp: 100, month: 1 }), false, 'month 1 is refused');
  assert.equal(ok({ kind: 'rate', rate_bp: 100, month: END }), false, 'the end of the life is refused');
  w.close();
});

test('POST /api/life/scenario replaces only the unfired rows (fired ones stay), numbers new rows after the last id, offsets from from_month, skips rows outside the life', async () => {
  const w = await world({ n: 1, second: 1 });
  const changed = [];
  w.app.events.on('module.life.changed', () => changed.push(1));
  assert.deepEqual(rowsOf(w).map((r) => [r.id, r.month, r.kind]), [[1, 241, 'rate'], [2, 289, 'housing'], [3, 337, 'crash']]);
  w.jumpTo(240);
  w.advance(1);                                                              // month 241: the first default event (a rate shock) fires, for real
  assert.equal(rowsOf(w)[0].result, 'done');
  const r = w.post('life', '/scenario', { id: '2008' }, w.teacherA);
  assert.deepEqual([r.ok, r.scenario, r.from_month, r.removed, r.inserted, r.skipped], [true, '2008', 241, 2, 6, 0]);
  const rows = rowsOf(w);
  assert.deepEqual(rows.map((x) => [x.id, x.month, x.kind, x.fired_month === null]), [[1, 241, 'rate', false], [4, 244, 'correction', true], [5, 247, 'crash', true], [6, 248, 'housing', true], [7, 249, 'rate', true], [8, 250, 'rate', true], [9, 255, 'rally', true]]);
  assert.equal(rows[0].result, 'done', 'the fired row is untouched');
  assert.ok(rows.every((x) => x.skip === 0));
  assert.equal(changed.length, 1);
  const audit = w.app.db.prepare("SELECT actor, detail FROM audit_log WHERE action = 'life.scenario'").get();
  assert.equal(audit.actor, `player:${w.teacherA.id}`);
  assert.deepEqual(JSON.parse(audit.detail), { worldId: 1, id: '2008', from_month: 241, removed: 2, inserted: 6, skipped: 0 });
  // Stable clears the unfired rows and leaves the fired one
  assert.deepEqual([w.post('life', '/scenario', { id: 'stable' }, w.teacherA).removed, rowsOf(w).length], [6, 1]);
  // from_month: later than now, rows past the end of the life skipped; earlier than now refused
  const late = w.post('life', '/scenario', { id: '2008', from_month: 570 }, w.teacherA);
  assert.deepEqual([late.inserted, late.skipped], [2, 4]);   // offsets 3 and 6 land on 573 and 576; 7, 8, 9 and 14 would be 577 or later
  assert.deepEqual(rowsOf(w).slice(1).map((x) => x.month), [573, 576]);
  assert.equal(w.status(() => w.post('life', '/scenario', { id: '2008', from_month: 100 }, w.teacherA)), 400);
  assert.equal(w.status(() => w.post('life', '/scenario', { id: '2008', from_month: END }, w.teacherA)), 400);
  assert.equal(w.status(() => w.post('life', '/scenario', { id: 'nope' }, w.teacherA)), 404);
  assert.equal(w.status(() => w.post('life', '/scenario', {}, w.teacherA)), 404);
  assert.equal(w.status(() => w.post('life', '/scenario', { id: 5 }, w.teacherA)), 400);
  assert.equal(w.status(() => w.post('life', '/scenario', { id: '2008' }, w.teacherB)), 403, 'the world teacher only');
  // /teach carries the list for the picker
  const t = w.get('life', '/teach', w.teacherA);
  assert.deepEqual(t.scenarios.map((s) => s.id), ['stable', '2008', '1981-alberta', '2022-inflation']);
  assert.ok(t.scenarios.every((s) => s.name && s.blurb && Array.isArray(s.events)));
  w.close();
});

for (const sc of SCENARIOS) {
  test(`scenario "${sc.id}" runs in a full-config world: every event fires through the real service, the ticks do not fail`, async () => {
    const w = await world({ n: 2 });
    const r = w.post('life', '/scenario', { id: sc.id }, w.teacherA);
    assert.equal(r.inserted, sc.events.length);
    for (let left = sc.events.reduce((m, e) => Math.max(m, e.offset), 0) + 2; left > 0; left -= 12) w.advance(Math.min(12, left));   // an advance is 1-12 months
    assert.deepEqual(failures(w), []);
    const rows = rowsOf(w);
    assert.equal(rows.length, sc.events.length);
    assert.ok(rows.every((x) => x.fired_month !== null && x.result === 'done'), JSON.stringify(rows));
    const q = (sql, ...a) => w.app.db.prepare(sql).all(...a);
    const kinds = sc.events.map((e) => e.kind);
    assert.equal(q('SELECT 1 FROM exchange_events').length, kinds.filter((x) => ['correction', 'crash', 'rally', 'scandal', 'boom'].includes(x)).length);
    assert.equal(q('SELECT 1 FROM housing_market').length, kinds.filter((x) => x === 'housing').length);
    assert.equal(q('SELECT 1 FROM insurance_triggers').length, kinds.filter((x) => x === 'insurance').length);
    const lastOf = (kind, field) => sc.events.filter((e) => e.kind === kind).at(-1)?.args[field];
    const pol = q('SELECT policy_bp, inflation_bp, pending_inflation_bp FROM rates_policy')[0];
    if (lastOf('rate', 'rate_bp') !== undefined) assert.equal(pol.policy_bp, lastOf('rate', 'rate_bp'));
    if (lastOf('inflation', 'inflation_bp') !== undefined) assert.equal(pol.pending_inflation_bp ?? pol.inflation_bp, lastOf('inflation', 'inflation_bp'));
    // the audit trail of the services (actor system)
    assert.equal(q("SELECT 1 FROM audit_log WHERE action IN ('rates.policy', 'rates.inflation', 'housing.market', 'insurance.trigger', 'exchange.event') AND actor = 'system'").length,
      kinds.filter((x) => x !== 'stable').length);
    // the feed heard the town events
    const town = w.feedRows().filter((x) => x.class_id === null).map((x) => x.text);
    if (kinds.includes('rate')) assert.ok(town.some((t) => /^Rates: the Bank of DAA will move to/.test(t)), town.join(' | '));
    if (kinds.includes('insurance')) assert.ok(town.some((t) => /^Town event next month: Car repair/.test(t)), town.join(' | '));
    w.close();
  });
}

test('the 2022 inflation shock reaches the price index at the next year step (rates.setInflation, then month 13)', async () => {
  const w = await world({ n: 1 });
  w.post('life', '/scenario', { id: '2022-inflation' }, w.teacherA);
  w.advance(12);                                                              // month 13: the year step uses the 8% set at month 2
  const row = w.app.db.prepare('SELECT inflation_bp, price_index_bp FROM rates_policy').get();
  assert.equal(row.inflation_bp, 800);
  assert.equal(row.price_index_bp, 10800);
  assert.equal(w.app.world.priceIndex(), 10800);
  w.close();
});

test('rates.setInflation: 0-1000 whole basis points, queued for the next tick, the same as the teacher\'s route, idempotent', async () => {
  const w = await world({ n: 1 });
  const life = w.k('life');
  const set = (bp) => life.modules.call('rates', 'setInflation', { inflation_bp: bp });
  for (const bad of [-1, 1001, 1.5, '300', null, undefined, NaN, 2 ** 53]) assert.equal(w.status(() => set(bad)), 400, String(bad));
  assert.equal(w.status(() => life.modules.call('rates', 'setInflation')), 400);
  const a = set(450), b = set(450);
  assert.deepEqual(a, { inflation_bp: 450, applies_from_month: 2 });
  assert.deepEqual(b, a);
  assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM rates_policy').get().n, 1);
  assert.equal(w.app.db.prepare('SELECT pending_inflation_bp FROM rates_policy').get().pending_inflation_bp, 450);
  assert.equal(set(0).inflation_bp, 0);
  assert.equal(set(1000).inflation_bp, 1000);
  assert.equal(w.app.db.prepare("SELECT actor FROM audit_log WHERE action = 'rates.inflation' ORDER BY id DESC").get().actor, 'system');
  const viaRoute = w.post('rates', '/inflation', { inflation_bp: 300 }, w.teacherA);
  assert.deepEqual([viaRoute.ok, viaRoute.inflation_bp, viaRoute.applies_from_month], [true, 300, 2]);
  assert.equal(w.app.db.prepare("SELECT actor FROM audit_log WHERE action = 'rates.inflation' ORDER BY id DESC").get().actor, `player:${w.teacherA.id}`);
  assert.equal(w.status(() => w.post('rates', '/inflation', { inflation_bp: 1001 }, w.teacherA)), 400);
  w.close();
});

test('insurance.triggerEvent: a catalogue event for the whole town, queued for the next tick; one per event per month; the feed hears it', async () => {
  const w = await world({ n: 1 });
  const life = w.k('life');
  const trig = (args) => life.modules.call('insurance', 'triggerEvent', args);
  for (const bad of [{ event: 'nope', scope: 'town' }, { event: 'dental', scope: 'class' }, { event: 'dental' }, { scope: 'town' }, { event: 5, scope: 'town' }, null, undefined]) assert.equal(w.status(() => trig(bad)), 400, JSON.stringify(bad));
  const a = trig({ event: 'dental', scope: 'town' });
  assert.deepEqual([a.event, a.already, a.applies_from_month], ['dental', false, 2]);
  const b = trig({ event: 'dental', scope: 'town' });
  assert.deepEqual([b.id, b.already], [a.id, true]);
  const c = trig({ event: 'car-repair', scope: 'town' });
  assert.ok(c.id > a.id);
  const rows = w.app.db.prepare('SELECT event_key, scope, class_id, by_player, processed_month FROM insurance_triggers ORDER BY id').all();
  assert.deepEqual(rows.map((r) => [r.event_key, r.scope, r.class_id, r.by_player, r.processed_month]), [['dental', 'town', null, 0, null], ['car-repair', 'town', null, 0, null]]);
  assert.deepEqual(w.feedRows().map((r) => [r.class_id, r.text]), [[null, 'Town event next month: Dental emergency'], [null, 'Town event next month: Car repair']]);
  w.advance(1);
  assert.ok(w.app.db.prepare('SELECT processed_month FROM insurance_triggers').all().every((r) => r.processed_month === 2));
  assert.equal(w.app.db.prepare("SELECT actor FROM audit_log WHERE action = 'insurance.trigger'").all().every((r) => r.actor === 'system'), true);
  // the teacher's route is unchanged: after-commit event, a teacher's player id, class scope
  const t = w.post('insurance', '/trigger', { event: 'tax-refund', scope: 'town' }, w.teacherA);
  assert.deepEqual([t.ok, t.applies_from_month], [true, 3]);
  assert.equal(w.app.db.prepare('SELECT by_player FROM insurance_triggers ORDER BY id DESC').get().by_player, w.teacherA.id);
  w.close();
});

test('config events with the new kinds: validated at boot, fired through the real services; bad ones are skipped, not fatal', async () => {
  const events = [
    { month: 3, kind: 'correction', headline: 'A correction' },
    { month: 4, kind: 'boom', ticker: 'KEYS', headline: 'Keystone booms' },
    { month: 5, kind: 'scandal', headline: 'no ticker: skipped' },
    { month: 6, kind: 'scandal', ticker: 'NOPE', headline: 'unknown ticker: skipped' },
    { month: 7, kind: 'inflation', inflation_bp: 1001, headline: 'out of bounds: skipped' },
    { month: 8, kind: 'inflation', inflation_bp: 500, headline: 'inflation 5%' },
    { month: 9, kind: 'insurance', event: 'dental', headline: 'a dental wave' },
    { month: 10, kind: 'insurance', event: 'nope', headline: 'skipped' },
    { month: 11, kind: 'rally', headline: 'rally\u0001' },
  ];
  const w = await world({ n: 1, config: { ...CONFIG, options: { ...CONFIG.options, life: { events } } } });
  assert.deepEqual(rowsOf(w).map((r) => [r.month, r.kind, JSON.parse(r.args)]),
    [[3, 'correction', {}], [4, 'boom', { ticker: 'KEYS' }], [8, 'inflation', { inflation_bp: 500 }], [9, 'insurance', { event: 'dental', scope: 'town' }]]);
  w.advance(10);
  assert.deepEqual(failures(w), []);
  assert.deepEqual(w.app.db.prepare('SELECT kind, ticker, headline FROM exchange_events ORDER BY id').all().map((r) => ({ ...r })), [{ kind: 'correction', ticker: null, headline: 'A correction' }, { kind: 'boom', ticker: 'KEYS', headline: 'Keystone booms' }]);
  const infl = w.app.db.prepare('SELECT pending_inflation_bp, inflation_bp FROM rates_policy').get();
  assert.equal(infl.pending_inflation_bp ?? infl.inflation_bp, 500);
  assert.equal(w.app.db.prepare('SELECT COUNT(*) AS n FROM insurance_triggers').get().n, 1);
  w.close();
});
