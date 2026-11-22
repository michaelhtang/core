// savings: every student gets a HISA (no overdraft). Interest is a faucet: each world month floor(balance x rate / 12) is minted into it.
// GICs are fixed-term deposits, each its own account of kind 'gic:<n>' (the ledger allows one account per kind per owner, so the
// counter n is what makes them unique; accounts.kind is plain text, so the colon is fine). A GIC compounds annually and is paid
// into chequing at maturity: principal back from the GIC account, interest from the mint, in one transaction. Net worth snapshots are
// written at the end of every month's tick (savings loads after jobs and bills, so it is month-end).
import { defineModule } from '../../lib/modules.js';
import { dice } from '../../lib/kernel.js';
import { HISA_BP, GIC_TERMS, GIC_MIN_CENTS, MAX_RATE_BP, PAY_KIND } from './constants.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="13" width="4" height="7"/><rect x="10" y="9" width="4" height="11"/><rect x="16" y="5" width="4" height="15"/><path d="M3 21h18"/></svg>';

// Integer interest: balance x bp / 10000 / 12, floored.
export const monthlyInterest = (balance, bp) => Math.floor((balance * bp) / 120000);
// Annual compounding, floored once at the end: principal x (1 + r)^years, exactly, in BigInt (cents x 10000^years would pass 2^53).
export function maturityValue(principal, bp, termMonths) {
  const years = BigInt(termMonths / 12);
  return Number((BigInt(principal) * (10000n + BigInt(bp)) ** years) / 10000n ** years);
}

const hisaDefaultBp = (k) => (k.config.hisaRate === undefined ? HISA_BP : Math.round(k.config.hisaRate * 100));
const gicTerms = (k) => Object.fromEntries(Object.entries(GIC_TERMS).map(([t, bp]) => [t, k.config.gicRates?.[t] === undefined ? bp : Math.round(k.config.gicRates[t] * 100)]));
// The HISA rate. When `rates` is loaded it announces the rate (module.rates.changed, stored in savings_rates at the first tick of each world),
// and that wins; savings has no other way to tell rates is loaded, so a world with a savings_rates row is "managed". Otherwise: the teacher's
// value for this world if set, else config.options.savings.hisaRate, else the default.
const ratesRow = (k, worldId) => k.db.prepare('SELECT hisa_bp FROM savings_rates WHERE world_id = ?').get(worldId);
const ratesManaged = (k, worldId) => !!ratesRow(k, worldId);
const hisaBp = (k, worldId) => ratesRow(k, worldId)?.hisa_bp ?? k.db.prepare('SELECT hisa_bp FROM savings_policy WHERE world_id = ?').get(worldId)?.hisa_bp ?? hisaDefaultBp(k);

const acct = (k, playerId, kind) => k.ledger.openAccount({ ownerType: 'player', ownerId: playerId, kind });
const chequingOf = (k, playerId) => k.ledger.accountId('player', playerId, 'chequing');
// Net worth = every account (the mortgage and unpaid bills are already negative in the ledger) + the home's value, which is not money: housing announces it
// (module.housing.value) and we keep the latest per player and world, so a Season 1 home never counts in Season 2.
const homeValue = (k, playerId) => k.db.prepare('SELECT home_value FROM savings_home WHERE player_id = ? AND world_id = ?').get(playerId, k.world.current().id)?.home_value ?? 0;
// The same for holdings in the exchange (module.exchange.value): shares and fund units are not money, so the latest announced value is added.
const exchangeValue = (k, playerId) => k.db.prepare('SELECT holdings FROM savings_exchange WHERE player_id = ? AND world_id = ?').get(playerId, k.world.current().id)?.holdings ?? 0;
const sumBalances = (k, playerId) => k.db.prepare("SELECT COALESCE(SUM(balance_cents), 0) AS n FROM accounts WHERE owner_type = 'player' AND owner_id = ?").get(playerId).n + homeValue(k, playerId) + exchangeValue(k, playerId);

function move(k, playerId, direction, cents) {
  const hisa = acct(k, playerId, 'hisa');
  const cheq = chequingOf(k, playerId);
  const [from, to, memo] = direction === 'to_hisa' ? [cheq, hisa, 'To high-interest savings'] : [hisa, cheq, 'From high-interest savings'];
  return k.ledger.transfer({ kind: 'move', actor: `player:${playerId}`, from, to, cents, memo });
}

function buyGic(k, playerId, term, cents) {
  const rate = gicTerms(k)[term];
  if (rate === undefined) throw new k.HttpError(400, `Terms are ${Object.keys(GIC_TERMS).join(', ')} months`);
  if (cents < GIC_MIN_CENTS) throw new k.HttpError(400, `The minimum GIC is $${GIC_MIN_CENTS / 100}`);
  return k.db.txn(() => {
    const world = k.world.current();
    const n = k.db.prepare('SELECT COUNT(*) AS n FROM savings_gics WHERE player_id = ?').get(playerId).n + 1;
    const account = acct(k, playerId, `gic:${n}`);
    k.db.prepare('INSERT INTO savings_gics (account_id, player_id, world_id, principal, rate_bp, start_month, term_months) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(account, playerId, world.id, cents, rate, world.month, term);
    k.ledger.transfer({ kind: 'gic_buy', actor: `player:${playerId}`, from: chequingOf(k, playerId), to: account, cents, memo: `${term}-month GIC at ${rate / 100}%` });
    return account;
  });
}

// Pay out every GIC of these students that is due: principal leaves the GIC account, interest is minted, all of it lands in chequing.
function matureGics(k, world, month, studentIds) {
  const due = k.db.prepare(`SELECT * FROM savings_gics WHERE world_id = ? AND matured_month IS NULL AND start_month + term_months <= ?
    AND player_id IN (SELECT value FROM json_each(?)) ORDER BY account_id`).all(world.id, month, JSON.stringify(studentIds));
  k.forEachPlayer(due, (g) => {                                                  // each GIC (one student's) in its own savepoint
    const interest = maturityValue(g.principal, g.rate_bp, g.term_months) - g.principal;
    const legs = [{ account: g.account_id, cents: -g.principal, memo: 'GIC matured' }, { account: chequingOf(k, g.player_id), cents: g.principal + interest, memo: `GIC matured: ${g.term_months} months at ${g.rate_bp / 100}%` }];
    if (interest > 0) legs.push({ account: k.ledger.system('mint'), cents: -interest, memo: 'GIC interest' });
    k.ledger.post({ kind: 'gic_maturity', meta: { gic: g.account_id, principal: g.principal, interest }, legs });
    k.db.prepare('UPDATE savings_gics SET matured_month = ? WHERE account_id = ?').run(month, g.account_id);
  }, (g) => g.player_id);
}

const ratio = (a, b) => (b ? a / b : null);
// A tiny deterministic dice (0..99) so a sim run is repeatable.

// The Today card's facts (modules/today): read-only. idleChequingCents is simply the chequing balance; netWorthCents is the /status figure.
function todayFacts(k, { playerId }) {
  const bal = (kind) => { const a = k.ledger.accountId('player', playerId, kind); return a ? k.ledger.balance(a) : 0; };
  const gics = k.db.prepare('SELECT COUNT(*) AS n FROM savings_gics WHERE player_id = ? AND world_id = ? AND matured_month IS NULL').get(playerId, k.world.current().id).n;
  return { idleChequingCents: bal('chequing'), hisaCents: bal('hisa'), gicCount: gics, netWorthCents: sumBalances(k, playerId), hisaRateBp: hisaBp(k, k.world.current().id) };
}

export default defineModule({
  id: 'savings',
  services: { todayFacts, hisaRate: (k, { worldId } = {}) => ({ bp: hisaBp(k, Number.isSafeInteger(worldId) ? worldId : k.world.current().id) }) },   // world-level, read-only (retirement's projection)
  options: { hisaRate: 'HISA rate in PERCENT (2.5 = 2.5%), not bp', gicRates: '{ <term>: PERCENT }, not bp' },
  requires: ['bank-basic'],

  migrations: [{ id: '001_savings', sql: `
CREATE TABLE savings_gics (
  account_id    INTEGER PRIMARY KEY REFERENCES accounts(id),
  player_id     INTEGER NOT NULL REFERENCES players(id),
  world_id      INTEGER NOT NULL REFERENCES worlds(id),   -- seasons restart the month count, so a GIC belongs to one world
  principal     INTEGER NOT NULL CHECK (principal > 0),
  rate_bp       INTEGER NOT NULL,
  start_month   INTEGER NOT NULL,
  term_months   INTEGER NOT NULL,
  matured_month INTEGER
);
CREATE INDEX savings_gics_due ON savings_gics(world_id, matured_month, player_id);
CREATE TABLE savings_snapshots (
  player_id INTEGER NOT NULL REFERENCES players(id),
  world_id  INTEGER NOT NULL REFERENCES worlds(id),
  month     INTEGER NOT NULL,
  net_worth INTEGER NOT NULL,
  PRIMARY KEY (player_id, world_id, month)
);
CREATE TABLE savings_policy (   -- the teacher's HISA rate for a world; read at each tick, so a change applies from the next one
  world_id INTEGER PRIMARY KEY REFERENCES worlds(id),
  hisa_bp  INTEGER NOT NULL,
  set_by   INTEGER,
  updated  INTEGER NOT NULL
)` }, { id: '002_rates', sql: `
CREATE TABLE savings_rates (    -- the HISA rate the Bank of DAA last announced for a world (module.rates.changed)
  world_id INTEGER PRIMARY KEY REFERENCES worlds(id),
  hisa_bp  INTEGER NOT NULL,
  month    INTEGER NOT NULL
)` }, { id: '003_home_value', sql: `
CREATE TABLE savings_home (     -- the home value housing last announced (module.housing.value), per player and world; 0 after a sale
  player_id  INTEGER NOT NULL REFERENCES players(id),
  world_id   INTEGER NOT NULL REFERENCES worlds(id),
  home_value INTEGER NOT NULL,
  PRIMARY KEY (player_id, world_id)
)` }, { id: '004_exchange_value', sql: `
CREATE TABLE savings_exchange (  -- the holdings value the exchange last announced (module.exchange.value), per player and world; 0 after everything is sold
  player_id INTEGER NOT NULL REFERENCES players(id),
  world_id  INTEGER NOT NULL REFERENCES worlds(id),
  holdings  INTEGER NOT NULL,
  PRIMARY KEY (player_id, world_id)
)` }],

  events: {
    'module.rates.changed': (k, { worldId, month, hisaBp: bp }) => {
      k.db.prepare('INSERT INTO savings_rates (world_id, hisa_bp, month) VALUES (?, ?, ?) ON CONFLICT (world_id) DO UPDATE SET hisa_bp = excluded.hisa_bp, month = excluded.month').run(worldId, bp, month);
    },
    'module.housing.value': (k, { playerId, worldId, homeValue: v }) => {
      if (!Number.isSafeInteger(playerId) || !Number.isSafeInteger(v) || v < 0) return;
      k.db.prepare('INSERT INTO savings_home (player_id, world_id, home_value) VALUES (?, ?, ?) ON CONFLICT (player_id, world_id) DO UPDATE SET home_value = excluded.home_value').run(playerId, Number.isSafeInteger(worldId) ? worldId : k.world.current().id, v);
    },
    'module.exchange.value': (k, { playerId, worldId, holdings }) => {
      if (!Number.isSafeInteger(playerId) || !Number.isSafeInteger(holdings) || holdings < 0) return;
      k.db.prepare('INSERT INTO savings_exchange (player_id, world_id, holdings) VALUES (?, ?, ?) ON CONFLICT (player_id, world_id) DO UPDATE SET holdings = excluded.holdings').run(playerId, Number.isSafeInteger(worldId) ? worldId : k.world.current().id, holdings);
    },
  },

  panels: [{ id: 'networth', building: { key: 'networth', name: 'Net Worth', icon: ICON }, src: 'savings.js' }],
  teacherPanels: [{ id: 'savings-teach', title: 'Savings', src: 'teach.js' }],

  onPlayer(k, player) { acct(k, player.id, 'hisa'); },
  onLogin(k, player) { acct(k, player.id, 'hisa'); },   // students made before the module was enabled

  // Order within a month: GIC maturities, HISA interest, then the net worth snapshot (so it includes both).
  onTick(k, { month, classes }) {
    const world = k.world.current();
    const bp = hisaBp(k, world.id);
    const ids = classes.flatMap((c) => c.studentIds);
    matureGics(k, world, month, ids);
    k.forEachPlayer(ids, (id) => {
      const hisa = k.ledger.accountId('player', id, 'hisa');
      const interest = hisa ? monthlyInterest(k.ledger.balance(hisa), bp) : 0;
      if (interest > 0) k.ledger.post({ kind: 'interest', meta: { month, bp }, legs: [{ account: k.ledger.system('mint'), cents: -interest, memo: `HISA interest ${bp / 100}%` }, { account: hisa, cents: interest, memo: `Interest at ${bp / 100}%` }] });
    });
    k.db.prepare(`INSERT OR REPLACE INTO savings_snapshots (player_id, world_id, month, net_worth)
      SELECT owner_id, ?, ?, SUM(balance_cents) + COALESCE((SELECT home_value FROM savings_home h WHERE h.player_id = owner_id AND h.world_id = ?), 0)
        + COALESCE((SELECT holdings FROM savings_exchange x WHERE x.player_id = owner_id AND x.world_id = ?), 0)
      FROM accounts WHERE owner_type = 'player' AND owner_id IN (SELECT value FROM json_each(?)) GROUP BY owner_id`)
      .run(world.id, month, world.id, world.id, JSON.stringify(ids));
    // module.savings.snapshot per student, after the snapshot row (outfitters' "Emergency fund" umbrella listens)
    const snap = k.db.prepare('SELECT net_worth FROM savings_snapshots WHERE player_id = ? AND world_id = ? AND month = ?');
    k.forEachPlayer(ids, (id) => {
      const hisa = k.ledger.accountId('player', id, 'hisa');
      const row = snap.get(id, world.id, month);
      if (hisa && row) k.events.emit('snapshot', { playerId: id, worldId: world.id, month, hisa: k.ledger.balance(hisa), netWorth: row.net_worth });
    });
  },

  // Bots: put 10-30% of what is left after bills into HISA; one in five buys a 12-month GIC once HISA passes $1,000.
  simulate(k, { month, students }) {
    for (const { id } of students) {
      const cheq = chequingOf(k, id);
      if (!cheq) continue;
      const left = k.ledger.balance(cheq);
      const cents = Math.floor((left * (10 + dice(id, month, 1) / 5)) / 100);
      if (cents > 0) move(k, id, 'to_hisa', cents);
      const hisa = k.ledger.balance(acct(k, id, 'hisa'));
      if (hisa > 100000 && dice(id, month, 2) < 20) {
        move(k, id, 'to_chequing', Math.floor(hisa / 2));
        buyGic(k, id, 12, Math.floor(hisa / 2));
      }
    }
  },

  routes: [
    {
      method: 'GET', path: '/status', access: 'student',
      handler(k, { user }) {
        const world = k.world.current();
        const hisa = acct(k, user.id, 'hisa');
        const cheq = chequingOf(k, user.id);
        const gics = k.db.prepare('SELECT * FROM savings_gics WHERE player_id = ? AND world_id = ? ORDER BY account_id').all(user.id, world.id).map((g) => ({
          account_id: g.account_id, principal_cents: g.principal, rate_bp: g.rate_bp, term_months: g.term_months, start_month: g.start_month,
          matures_month: g.start_month + g.term_months, matured_month: g.matured_month,
          maturity_cents: maturityValue(g.principal, g.rate_bp, g.term_months),
        }));
        const snapshots = k.db.prepare('SELECT month, net_worth FROM (SELECT month, net_worth FROM savings_snapshots WHERE player_id = ? AND world_id = ? ORDER BY month DESC LIMIT 12) ORDER BY month')
          .all(user.id, world.id).map((s) => ({ month: s.month, net_worth_cents: s.net_worth }));
        return {
          month: world.month, chequing_cents: k.ledger.balance(cheq), hisa_cents: k.ledger.balance(hisa), hisa_rate_bp: hisaBp(k, world.id), rates_managed: ratesManaged(k, world.id),
          gic_rates: Object.entries(gicTerms(k)).map(([term, bp]) => ({ term_months: Number(term), rate_bp: bp })), gic_min_cents: GIC_MIN_CENTS,
          gics, net_worth_cents: sumBalances(k, user.id), snapshots, home_value_cents: homeValue(k, user.id), exchange_value_cents: exchangeValue(k, user.id), mortgage_cents: k.ledger.accountsOf('player', user.id).filter((a) => a.kind === 'mortgage' || a.kind.startsWith('mortgage:')).reduce((t, a) => t + a.balance_cents, 0),   // every home's mortgage (6b: a rental's is 'mortgage:<id>')
          bills_owed_cents: ((a) => (a ? k.ledger.balance(a) : 0))(k.ledger.accountId('player', user.id, 'payable')),   // unpaid bills (bills' payable account, negative), already in net worth
        };
      },
    },
    {
      method: 'POST', path: '/move', access: 'student',
      handler(k, { user, body }) {
        const direction = k.input.str(body, 'direction', { max: 20 });
        if (direction !== 'to_hisa' && direction !== 'to_chequing') throw new k.HttpError(400, 'direction must be to_hisa or to_chequing');
        const txn = move(k, user.id, direction, k.input.int(body, 'cents', { min: 1, max: 100_000_000_000 }));
        return { txn };
      },
    },
    {
      method: 'POST', path: '/gic', access: 'student',
      handler(k, { user, body }) {
        const account = buyGic(k, user.id, k.input.int(body, 'term_months', { min: 1, max: 600 }), k.input.int(body, 'cents', { min: 1, max: 100_000_000_000 }));
        return { account_id: account };
      },
    },

    // ---- teacher ----
    {
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user }) {
        const world = k.world.current();
        const mine = k.players.classesFor(user);
        const ids = JSON.stringify(mine.map((c) => c.id));
        const total = new Map(k.db.prepare(`SELECT p.class_id, SUM(a.balance_cents) AS n FROM players p JOIN accounts a ON a.owner_type = 'player' AND a.owner_id = p.id
          WHERE p.class_id IN (SELECT value FROM json_each(?)) AND (a.kind = 'hisa' OR a.kind LIKE 'gic:%') GROUP BY p.class_id`).all(ids).map((r) => [r.class_id, r.n]));
        // Chequing-side flows this season: net pay in, and money put into HISA (net of moves back) and GICs.
        const flows = new Map();
        for (const r of k.db.prepare(`SELECT p.class_id, t.kind, SUM(e.amount_cents) AS n FROM entries e
          JOIN accounts a ON a.id = e.account_id AND a.kind = 'chequing' AND a.owner_type = 'player' JOIN players p ON p.id = a.owner_id JOIN txns t ON t.id = e.txn_id
          WHERE p.class_id IN (SELECT value FROM json_each(?)) AND t.kind IN (?, 'savings.move', 'savings.gic_buy') AND t.created >= ? GROUP BY p.class_id, t.kind`).all(ids, PAY_KIND, world.created)) {
          const f = flows.get(r.class_id) ?? { pay: 0, saved: 0 };
          if (r.kind === PAY_KIND) f.pay += r.n; else f.saved -= r.n;
          flows.set(r.class_id, f);
        }
        return {
          hisa_rate_bp: hisaBp(k, world.id), rates_managed: ratesManaged(k, world.id), can_set_rate: !ratesManaged(k, world.id) && k.policy.can(user, 'world.settings'), max_rate_bp: MAX_RATE_BP,
          classes: mine.map((c) => { const f = flows.get(c.id) ?? { pay: 0, saved: 0 }; return { id: c.id, name: c.name, total_savings_cents: total.get(c.id) ?? 0, saved_cents: f.saved, net_pay_cents: f.pay, savings_rate: ratio(f.saved, f.pay) }; }),
        };
      },
    },
    {
      method: 'POST', path: '/rate', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');                                            // the policy rate is the whole world's
        const world = k.world.active();   // 409 between seasons: a closed world never ticks again, so this would be lost
        if (ratesManaged(k, world.id)) throw new k.HttpError(403, 'The HISA rate follows the Bank of DAA policy rate. Change the policy rate there instead.');
        const bp = k.input.int(body, 'hisa_bp', { min: 0, max: MAX_RATE_BP });
        k.db.txn((tx) => {
          k.db.prepare('INSERT INTO savings_policy (world_id, hisa_bp, set_by, updated) VALUES (?, ?, ?, ?) ON CONFLICT (world_id) DO UPDATE SET hisa_bp = excluded.hisa_bp, set_by = excluded.set_by, updated = excluded.updated')
            .run(world.id, bp, user.id, k.clock.now());
          k.audit('rate', { worldId: world.id, hisa_bp: bp }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('rate', { worldId: world.id, hisa_bp: bp }));   // module.savings.rate
        });
        return { ok: true, hisa_rate_bp: bp, applies_from_month: world.month + 1 };
      },
    },
  ],
});
