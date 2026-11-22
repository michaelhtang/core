// rates: the Bank of DAA (docs/phase2.md, Wave 2a). One policy rate per world; every other rate is derived from it, never stored.
// Inflation (docs/phase2.md "Inflation"): a world price index in basis points (starts at 10000) steps once per world year, at months 13, 25, 37, ...,
// by (1 + inflation), rounded to a basis point; the teacher's new inflation rate is queued like the policy rate and applies at the next tick, so it
// is the rate the next step uses. The core keeps priceIndexBp from `module.rates.changed`; other modules scale their prices by k.world.priceIndex().
// A new policy rate is queued (pending_bp) and takes effect at the next world tick, where `module.rates.changed` is emitted;
// the same event is emitted once at a world's first tick so listeners (savings, later housing and credit) can initialize.
// `module.rates.pending { worldId, pendingBp, effectiveMonth, mortgage5yBp }` says a change is queued (after the teacher's commit), and `pendingBp: null` that it was
// cancelled (the teacher queued the rate already in force) or applied (inside the tick, before the listeners' own ticks). mortgage5yBp is derive() of the
// pending rate (null with pendingBp null). Exchange pauses its bond-linked funds on it; housing prices new mortgages at mortgage5yBp (lenders price in the announcement).
import { defineModule } from '../../lib/modules.js';
import { POLICY_BP, MAX_POLICY_BP, SPREADS, CARD_APR_BP, ANNOUNCE_MONTHS, INFLATION_BP, MAX_INFLATION_BP, INDEX_BASE_BP } from './constants.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-6 9 6z"/><rect x="5" y="11" width="3" height="7"/><rect x="10.5" y="11" width="3" height="7"/><rect x="16" y="11" width="3" height="7"/><path d="M3 20h18"/></svg>';

// All derived rates for a policy rate; spreads and the card APR come from config.options.rates (bp), else the constants. Never below 0.
export function derive(k, policyBp) {
  const c = k.config;
  const prime = policyBp + (c.primeSpreadBp ?? SPREADS.prime);
  const floor0 = (n) => Math.max(0, n);
  return {
    policyBp, primeBp: floor0(prime),
    hisaBp: floor0(policyBp + (c.hisaSpreadBp ?? SPREADS.hisa)),
    mortgage5yBp: floor0(policyBp + (c.mortgage5ySpreadBp ?? SPREADS.mortgage5y)),
    mortgageVarBp: floor0(prime + (c.mortgageVarSpreadBp ?? SPREADS.mortgageVar)),
    locBp: floor0(prime + (c.locSpreadBp ?? SPREADS.loc)),
    cardAprBp: c.cardAprBp ?? CARD_APR_BP,
  };
}

const defaultPolicy = (k) => k.config.policyBp ?? POLICY_BP;
const defaultInflation = (k) => (Number.isSafeInteger(k.config.inflationBp) && k.config.inflationBp >= 0 && k.config.inflationBp <= MAX_INFLATION_BP ? k.config.inflationBp : INFLATION_BP);
export const nextAnnouncement = (month) => { for (let m = month + 1; ; m++) if (ANNOUNCE_MONTHS.includes(((m - 1) % 12) + 1)) return m; };

const policyRow = (k, worldId) => k.db.prepare('SELECT policy_bp, pending_bp, inflation_bp, pending_inflation_bp, price_index_bp FROM rates_policy WHERE world_id = ?').get(worldId);
const historyOf = (k, worldId) => k.db.prepare('SELECT month, policy_bp FROM rates_history WHERE world_id = ? ORDER BY month').all(worldId);

// Queue a new policy rate for the next tick (the teacher's POST /policy and the queueRate service). Queuing the rate already in force cancels a queued change.
// module.rates.pending says so: after the teacher's commit, or (by: null, a service call that may run inside an advance) at once, inside the caller's
// transaction, so a later tick of the same advance can never be followed by a stale "pending" from an earlier month.
function queuePolicy(k, world, bp, by) {
  const cancelled = bp === (policyRow(k, world.id)?.policy_bp ?? defaultPolicy(k));
  const pending = cancelled ? null : bp;
  k.db.txn((tx) => {
    k.db.prepare(`INSERT INTO rates_policy (world_id, policy_bp, pending_bp, set_by, updated) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (world_id) DO UPDATE SET pending_bp = excluded.pending_bp, set_by = excluded.set_by, updated = excluded.updated`)
      .run(world.id, defaultPolicy(k), pending, by, k.clock.now());
    k.audit('policy', { worldId: world.id, policy_bp: bp, cancelled }, by == null ? 'system' : `player:${by}`);
    const announce = () => k.events.emit('pending', { worldId: world.id, pendingBp: pending, effectiveMonth: cancelled ? null : world.month + 1, mortgage5yBp: cancelled ? null : derive(k, pending).mortgage5yBp });
    if (by == null) announce(); else tx.onCommit(announce);
  });
  return { policy_bp: bp, applies_from_month: world.month + 1, cancelled };
}

// Queue a new annual inflation for the next tick (the teacher's POST /inflation and the setInflation service); the index steps by it at the next year step.
function queueInflation(k, world, bp, by) {
  k.db.txn(() => {
    k.db.prepare(`INSERT INTO rates_policy (world_id, policy_bp, pending_inflation_bp, set_by, updated) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (world_id) DO UPDATE SET pending_inflation_bp = excluded.pending_inflation_bp, set_by = excluded.set_by, updated = excluded.updated`)
      .run(world.id, defaultPolicy(k), bp, by, k.clock.now());
    k.audit('inflation', { worldId: world.id, inflation_bp: bp }, by == null ? 'system' : `player:${by}`);
  });
  return { inflation_bp: bp, applies_from_month: world.month + 1 };
}

export default defineModule({
  id: 'rates',
  // queueRate { rate_bp }: the life module's scheduled rate shock (docs/phase5-life.md 5b), through k.modules.call only. Same as the teacher's POST /policy.
  services: {
    queueRate(k, args) {
      const bp = args?.rate_bp;
      if (!Number.isSafeInteger(bp) || bp < 0 || bp > MAX_POLICY_BP) throw new k.HttpError(400, `queueRate: rate_bp must be a whole number from 0 to ${MAX_POLICY_BP}`);
      return queuePolicy(k, k.world.active(), bp, null);
    },
    // setInflation { inflation_bp } (0 to MAX_INFLATION_BP): the life module's scenario shocks; the same as the teacher's POST /inflation. Setting the same value again changes nothing.
    setInflation(k, args) {
      const bp = args?.inflation_bp;
      if (!Number.isSafeInteger(bp) || bp < 0 || bp > MAX_INFLATION_BP) throw new k.HttpError(400, `setInflation: inflation_bp must be a whole number from 0 to ${MAX_INFLATION_BP}`);
      return queueInflation(k, k.world.active(), bp, null);
    },
  },
  options: { policyBp: 'starting policy rate, bp', inflationBp: 'starting inflation, bp', primeSpreadBp: 'bp', hisaSpreadBp: 'bp', mortgage5ySpreadBp: 'bp', mortgageVarSpreadBp: 'bp over prime', locSpreadBp: 'bp over prime', cardAprBp: 'bp' },

  migrations: [{ id: '001_rates', sql: `
CREATE TABLE rates_policy (   -- one row per world; policy_bp is what applies now, pending_bp what applies at the next tick
  world_id   INTEGER PRIMARY KEY REFERENCES worlds(id),
  policy_bp  INTEGER NOT NULL,
  pending_bp INTEGER,
  set_by     INTEGER,
  updated    INTEGER NOT NULL
);
CREATE TABLE rates_history (  -- the policy rate as it applied from each month it was set (the first tick of a world, then each change)
  world_id  INTEGER NOT NULL REFERENCES worlds(id),
  month     INTEGER NOT NULL,
  policy_bp INTEGER NOT NULL,
  PRIMARY KEY (world_id, month)
)` }, { id: '002_inflation', sql: `
ALTER TABLE rates_policy ADD COLUMN inflation_bp INTEGER;               -- annual CPI that applies now (NULL until the first tick after this migration)
ALTER TABLE rates_policy ADD COLUMN pending_inflation_bp INTEGER;       -- the teacher's queued change, applied at the next tick
ALTER TABLE rates_policy ADD COLUMN price_index_bp INTEGER NOT NULL DEFAULT 10000` }, { id: '003_core_index', sql: `
-- the core keeps the price index now (migration 013, from module.rates.changed): fill it for the worlds that already have one
INSERT OR IGNORE INTO price_index (world_id, index_bp) SELECT world_id, price_index_bp FROM rates_policy WHERE price_index_bp > 0 AND world_id IN (SELECT id FROM worlds)` }],

  panels: [{ id: 'bank-of-daa', building: { key: 'bank-of-daa', name: 'Bank of DAA', icon: ICON }, src: 'rates.js' }],
  teacherPanels: [{ id: 'rates-teach', title: 'Bank of DAA', src: 'teach.js' }],

  onTick(k, { month }) {
    const world = k.world.current();
    const row = policyRow(k, world.id);
    const first = !k.db.prepare('SELECT 1 AS x FROM rates_history WHERE world_id = ? LIMIT 1').get(world.id);
    const bp = row?.pending_bp ?? row?.policy_bp ?? defaultPolicy(k);
    const infl = row?.pending_inflation_bp ?? row?.inflation_bp ?? defaultInflation(k);
    const step = !first && month > 1 && (month - 1) % 12 === 0;                // the index steps at months 13, 25, 37, ...
    const index = first ? INDEX_BASE_BP : row.price_index_bp;
    const newIndex = step ? Math.round((index * (10000 + infl)) / 10000) : index;
    const policyChanged = first || bp !== row.policy_bp;
    if (!policyChanged && !step && infl === row.inflation_bp && row.pending_bp === null && row.pending_inflation_bp === null) return;
    k.db.prepare(`INSERT INTO rates_policy (world_id, policy_bp, pending_bp, inflation_bp, pending_inflation_bp, price_index_bp, updated) VALUES (?, ?, NULL, ?, NULL, ?, ?)
      ON CONFLICT (world_id) DO UPDATE SET policy_bp = excluded.policy_bp, pending_bp = NULL, inflation_bp = excluded.inflation_bp, pending_inflation_bp = NULL,
        price_index_bp = excluded.price_index_bp, updated = excluded.updated`).run(world.id, bp, infl, newIndex, k.clock.now());
    if (row?.pending_bp != null) k.events.emit('pending', { worldId: world.id, pendingBp: null, effectiveMonth: null, mortgage5yBp: null });   // applied: inside the tick, like `changed`
    if (policyChanged) k.db.prepare('INSERT OR REPLACE INTO rates_history (world_id, month, policy_bp) VALUES (?, ?, ?)').run(world.id, month, bp);
    if (policyChanged || step) k.events.emit('changed', { worldId: world.id, month, ...derive(k, bp), inflationBp: infl, priceIndexBp: newIndex });   // module.rates.changed, inside the tick transaction: a listener's writes commit or roll back with it
  },

  routes: [
    {
      method: 'GET', path: '/current', access: 'any',
      handler(k, { user }) {
        const world = k.world.current();
        const row = policyRow(k, world.id);
        const history = historyOf(k, world.id);
        const policyBp = row?.policy_bp ?? defaultPolicy(k);
        const prev = history.length > 1 ? history.at(-2).policy_bp : null;   // the rate before the latest change, for "what changed for you"
        const kind = (r) => ({ policy_bp: r.policyBp, prime_bp: r.primeBp, hisa_bp: r.hisaBp, mortgage5y_bp: r.mortgage5yBp, mortgage_var_bp: r.mortgageVarBp, loc_bp: r.locBp, card_apr_bp: r.cardAprBp });
        return {
          month: world.month, ...kind(derive(k, policyBp)),
          previous: prev === null ? null : kind(derive(k, prev)),
          pending_bp: row?.pending_bp ?? null, pending_from_month: row?.pending_bp != null ? world.month + 1 : null,
          next_announcement_month: nextAnnouncement(world.month),
          history: history.map((h) => ({ month: h.month, policy_bp: h.policy_bp })),
          inflation_bp: row?.inflation_bp ?? defaultInflation(k), pending_inflation_bp: row?.pending_inflation_bp ?? null, price_index_bp: row?.price_index_bp ?? INDEX_BASE_BP, max_inflation_bp: MAX_INFLATION_BP,
          can_set: user.role === 'teacher' && k.policy.can(user, 'world.settings'), max_policy_bp: MAX_POLICY_BP,
        };
      },
    },
    {
      method: 'POST', path: '/policy', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');                                        // the policy rate is the whole world's
        const bp = k.input.int(body, 'policy_bp', { min: 0, max: MAX_POLICY_BP });
        const world = k.world.active();   // 409 between seasons: a closed world never ticks again, so this would be lost
        return { ok: true, ...queuePolicy(k, world, bp, user.id) };
      },
    },
    {
      method: 'POST', path: '/inflation', access: 'teacher',
      handler(k, { user, body }) {
        k.policy.assert(user, 'world.settings');                                        // inflation is the whole world's too
        const bp = k.input.int(body, 'inflation_bp', { min: 0, max: MAX_INFLATION_BP });
        const world = k.world.active();   // 409 between seasons: a closed world never ticks again, so this would be lost
        return { ok: true, ...queueInflation(k, world, bp, user.id) };
      },
    },
  ],
});
