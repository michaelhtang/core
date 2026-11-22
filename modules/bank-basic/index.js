// bank-basic: every student gets a chequing account when their card is created (empty), and the welcome grant from
// system:mint arrives on their FIRST LOGIN, so spare cards hold no money.
// Student-to-student transfers exist but are OFF until the teacher turns them on for a class, and then they are capped
// per transfer and per rolling 24 hours, same-class only, written to audit_log, and reversible by the teacher.
import { defineModule } from '../../lib/modules.js';
import { money } from '../../lib/kernel.js';
import { createThrottle } from '../../lib/throttle.js';
import { history, ACCOUNTS } from './history.js';

const DEFAULTS = { transfers_enabled: 0, per_transfer_cents: 5000, daily_cents: 10000 };   // off; $50 per transfer; $100 per day
const DAY_MS = 864e5;
const FEED_PAGE = 100;
const settingsFor = (k, classId) => k.db.prepare('SELECT * FROM bank_class_settings WHERE class_id = ?').get(classId) ?? DEFAULTS;

// Money this account sent in the last 24 hours, not counting transfers the teacher has reversed.
const sentSince = (k, accountId, since) => k.ledger.sumByKind({ account: accountId, kind: 'transfer', since, dir: 'out', excludeReversed: true });

// Guardrail: at most 20 transfers per player per 10 minutes (config options.bank-basic.transfersPer10Min overrides; in memory, per kernel).
// Reuses the login throttle's per-key window with a second instance; 'p<id>' is the key.
const MIN_CENTS = 100;
const MAX_CENTS = 100_000_000;   // $1,000,000
const throttles = new WeakMap();
const throttleFor = (k) => {
  if (!throttles.has(k)) throttles.set(k, createThrottle({ now: k.clock.now, ip: k.config.transfersPer10Min ?? 20, ipWindowMs: 10 * 60e3 }));
  return throttles.get(k);
};

export default defineModule({
  id: 'bank-basic',
  options: { startCents: 'welcome grant, cents', transfersPer10Min: 'transfers per player per 10 minutes' },
  // transfersEnabled { classId } -> { enabled }: read-only; housing (6b) opens student rent only where the teacher allows money between classmates.
  services: { transfersEnabled: (k, args) => ({ enabled: !!settingsFor(k, args?.classId).transfers_enabled }) },

  // Recorded as mod:bank-basic:001_settings (migration 004 renamed the old positional record, so existing databases do not re-run it).
  migrations: [{ id: '001_settings', sql: `
CREATE TABLE bank_class_settings (
  class_id           INTEGER PRIMARY KEY REFERENCES classes(id),
  transfers_enabled  INTEGER NOT NULL DEFAULT 0,
  per_transfer_cents INTEGER NOT NULL DEFAULT 5000,
  daily_cents        INTEGER NOT NULL DEFAULT 10000
)` }, { id: '002_transfer_class', sql: `
-- Which class each transfer belongs to (the sender's), so a teacher's feed is one indexed lookup. Backfilled from the ledger.
CREATE TABLE bank_transfers (txn_id INTEGER PRIMARY KEY REFERENCES txns(id), class_id INTEGER NOT NULL REFERENCES classes(id));
CREATE INDEX bank_transfers_class ON bank_transfers(class_id, txn_id);
INSERT INTO bank_transfers (txn_id, class_id)
  SELECT t.id, p.class_id FROM txns t JOIN players p ON p.id = json_extract(t.meta, '$.from')
  WHERE t.kind = 'bank-basic.transfer' AND p.class_id IS NOT NULL;` }],

  panels: [{ id: 'bank', building: { key: 'bank', name: 'Bank', icon: 'bank' }, src: 'bank.js' }],
  teacherPanels: [{ id: 'bank-teach', title: 'Bank', src: 'teach.js' }],

  onPlayer(k, player) {
    k.ledger.openAccount({ ownerType: 'player', ownerId: player.id, kind: 'chequing' });
  },

  // Idempotent per season: the grant is recorded as kind 'welcome' (stored bank-basic.welcome) with meta.reason = 'welcome' and
  // meta.worldId, and is never paid twice in one world. A returning student gets a new one in the next season. Grants from before
  // seasons existed have no worldId and count as the first world's.
  onLogin(k, player) {
    k.db.txn(() => {
      const chequing = k.ledger.openAccount({ ownerType: 'player', ownerId: player.id, kind: 'chequing' });
      const worldId = k.world.current().id;
      const paid = k.db.prepare(`SELECT 1 FROM entries e JOIN txns t ON t.id = e.txn_id
        WHERE e.account_id = ? AND t.kind = 'bank-basic.welcome' AND json_extract(t.meta, '$.reason') = 'welcome'
          AND COALESCE(json_extract(t.meta, '$.worldId'), (SELECT MIN(id) FROM worlds)) = ?`).get(chequing, worldId);
      if (paid) return;
      const cents = k.config.startCents ?? 50000;
      k.ledger.post({
        kind: 'welcome', actor: 'system', meta: { reason: 'welcome', worldId },
        legs: [{ account: k.ledger.system('mint'), cents: -cents, memo: 'Welcome grant' }, { account: chequing, cents, memo: 'Welcome grant' }],
      });
    });
  },

  routes: [
    {
      method: 'GET', path: '/status', access: 'student',
      handler(k, { user }) {
        const cfg = settingsFor(k, user.class_id);
        const from = k.ledger.accountId('player', user.id, 'chequing');
        return { enabled: !!cfg.transfers_enabled, per_transfer_cents: cfg.per_transfer_cents, daily_cents: cfg.daily_cents, sent_24h_cents: sentSince(k, from, k.clock.now() - DAY_MS) };
      },
    },
    {
      // The student's own transaction history (read-only): ?account=chequing|hisa, ?before=<entry id> for older rows. See history.js.
      method: 'GET', path: '/history', access: 'student',
      handler(k, { user, url }) {
        const kind = url?.searchParams.get('account') ?? 'chequing';
        if (!Object.hasOwn(ACCOUNTS, kind)) throw new k.HttpError(400, 'account must be chequing or hisa');
        const raw = url?.searchParams.get('before') ?? null;
        if (raw !== null && !/^\d{1,15}$/.test(raw)) throw new k.HttpError(400, 'before must be an entry id');
        const out = history(k, user.id, kind, raw === null ? undefined : Number(raw));
        if (!out) throw new k.HttpError(404, 'You do not have that account yet');
        return out;
      },
    },
    {
      method: 'POST', path: '/transfer', access: 'student',
      handler(k, { user, body }) {
        const { HttpError, input: { str, int } } = k;
        const cfg = settingsFor(k, user.class_id);
        if (!cfg.transfers_enabled) throw new HttpError(403, 'Sending money is turned off for your class');
        const cents = int(body, 'cents', { min: 1, max: MAX_CENTS });
        if (cents < MIN_CENTS) throw new HttpError(400, `The minimum transfer is ${money(MIN_CENTS)}`);
        if (cents > cfg.per_transfer_cents) throw new HttpError(400, `The limit is ${money(cfg.per_transfer_cents)} per transfer`);
        // same class only; teachers and system accounts are never reachable (role = 'student' and an account lookup)
        const to = k.db.prepare("SELECT id, username FROM players WHERE username = ? AND role = 'student' AND class_id = ?").get(str(body, 'to', { max: 64 }).trim(), user.class_id);
        if (!to) throw new HttpError(404, 'No one in your class has that username');
        if (to.id === user.id) throw new HttpError(400, "You can't send money to yourself");
        const from = k.ledger.accountId('player', user.id, 'chequing');
        const dest = k.ledger.accountId('player', to.id, 'chequing');
        if (!from || !dest) throw new HttpError(400, 'That student has no chequing account');
        const release = throttleFor(k).reserve(`p${user.id}`, '', { teacher: true });   // 429 when the player is over 20 in 10 minutes
        let txn;
        try {
          txn = k.db.txn(() => {
            const sent = sentSince(k, from, k.clock.now() - DAY_MS);
            if (sent + cents > cfg.daily_cents) throw new HttpError(400, `Daily limit: ${money(cfg.daily_cents)}. You have sent ${money(sent)} in the last 24 hours, so you can still send ${money(Math.max(0, cfg.daily_cents - sent))}.`);
            const id = k.ledger.post({
              kind: 'transfer', actor: `player:${user.id}`, meta: { from: user.id, to: to.id, fromName: user.username, toName: to.username, worldId: k.world.current().id },
              legs: [{ account: from, cents: -cents, memo: `Sent to ${to.username}` }, { account: dest, cents, memo: `Received from ${user.username}` }],
            });
            k.db.prepare('INSERT INTO bank_transfers (txn_id, class_id) VALUES (?, ?)').run(id, user.class_id);
            k.audit('transfer', { txn: id, to: to.id, cents }, `player:${user.id}`);
            return id;
          });
        } catch (e) { release(); throw e; }   // only transfers that happened count against the limit
        return { txn, balance_cents: k.ledger.balance(from) };
      },
    },

    // ---- teacher ----
    {
      method: 'GET', path: '/settings', access: 'teacher',
      handler(k, { user }) {
        const mine = new Set(k.players.classesFor(user).map((c) => c.id));            // only this teacher's classes
        return {
          classes: k.db.prepare(`SELECT c.id, c.name, c.course_id,
              COALESCE(s.transfers_enabled, ${DEFAULTS.transfers_enabled}) AS transfers_enabled,
              COALESCE(s.per_transfer_cents, ${DEFAULTS.per_transfer_cents}) AS per_transfer_cents,
              COALESCE(s.daily_cents, ${DEFAULTS.daily_cents}) AS daily_cents
            FROM classes c LEFT JOIN bank_class_settings s ON s.class_id = c.id ORDER BY c.id`).all().filter((c) => mine.has(c.id)),
        };
      },
    },
    {
      method: 'POST', path: '/settings', access: 'teacher',
      handler(k, { user, body }) {
        const { HttpError, input: { int, bool } } = k;
        const classId = int(body, 'class_id', { min: 1 });
        const enabled = bool(body, 'enabled');
        const per = int(body, 'per_transfer_cents', { min: 1, max: MAX_CENTS });
        const daily = int(body, 'daily_cents', { min: 1, max: MAX_CENTS });
        k.policy.assert(user, 'class.manage', { classId });                                 // 404 for a class that is not yours (or does not exist)
        if (per > daily) throw new HttpError(400, 'The per-transfer limit cannot be above the daily limit');
        k.db.txn((tx) => {
          k.db.prepare(`INSERT INTO bank_class_settings (class_id, transfers_enabled, per_transfer_cents, daily_cents) VALUES (?, ?, ?, ?)
            ON CONFLICT (class_id) DO UPDATE SET transfers_enabled = excluded.transfers_enabled, per_transfer_cents = excluded.per_transfer_cents, daily_cents = excluded.daily_cents`)
            .run(classId, enabled ? 1 : 0, per, daily);
          k.audit('settings', { class: classId, enabled, per, daily }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('settings', { classId }));   // module.bank-basic.settings
        });
        return { ok: true };
      },
    },
    {
      method: 'GET', path: '/transfers', access: 'teacher',
      handler(k, { user, url }) {
        // This teacher's classes only (the class is the sender's), newest first, FEED_PAGE per page: one indexed lookup in bank_transfers,
        // so a busy class elsewhere can never push this teacher's rows out of view. ?before=<txn id> pages backwards; `next` (the last
        // id returned, to send as ?before=) is present only when older rows exist.
        const raw = url?.searchParams.get('before') ?? null;
        if (raw !== null && !/^\d{1,15}$/.test(raw)) throw new k.HttpError(400, 'before must be a transfer id');
        const mine = k.players.classesFor(user);
        if (!mine.length) return { transfers: [] };
        const name = new Map(mine.map((c) => [c.id, c.name]));
        const rows = k.db.prepare('SELECT txn_id, class_id FROM bank_transfers WHERE class_id IN (SELECT value FROM json_each(?)) AND txn_id < ? ORDER BY txn_id DESC LIMIT ?')
          .all(JSON.stringify(mine.map((c) => c.id)), raw === null ? Number.MAX_SAFE_INTEGER : Number(raw), FEED_PAGE + 1);
        const more = rows.length > FEED_PAGE;
        if (more) rows.pop();
        const classOfTxn = new Map(rows.map((r) => [r.txn_id, r.class_id]));
        return {
          transfers: k.ledger.txnsByKind({ kind: 'transfer', ids: rows.map((r) => r.txn_id), limit: FEED_PAGE })
            .map((t) => ({ id: t.id, created: t.created, from_name: t.meta.fromName, to_name: t.meta.toName, cents: t.cents, class_name: name.get(classOfTxn.get(t.id)), reversed: t.reversed })),
          ...(more && { next: rows.at(-1).txn_id }),
        };
      },
    },
    {
      method: 'POST', path: '/transfers/:id/reverse', access: 'teacher',
      handler(k, { user, params }) {
        const txnId = k.input.idParam(params.id);
        const row = k.db.prepare("SELECT meta, created FROM txns WHERE id = ? AND kind = 'bank-basic.transfer'").get(txnId);
        if (!row) throw new k.HttpError(404, 'Transfer not found');
        const meta = JSON.parse(row.meta);
        const sender = k.players.classOf(meta.from);
        k.policy.assert(user, 'class.manage', { classId: sender?.id });                     // the sender's class decides
        // Only this season's transfers: an older one was reset with its season, and reversing it would move this season's money.
        // Transfers carry meta.worldId; ones from before that fall back to comparing timestamps.
        const w = k.world.current();
        const past = meta.worldId === undefined ? row.created < w?.created : meta.worldId !== w?.id;
        if (w?.status !== 'active' || past) throw new k.HttpError(409, 'That transfer is from a past season.');
        let txn;
        try {
          txn = k.db.txn(() => {
            const id = k.ledger.reverse(txnId, { actor: `player:${user.id}`, memo: 'Reversed by teacher' });
            k.audit('transfer.reverse', { reverses: txnId, txn: id, class: sender?.id }, `player:${user.id}`);   // class: so the activity log can scope it
            return id;
          });
        } catch (e) {
          if (e.code === 'INSUFFICIENT_FUNDS') throw new k.HttpError(409, 'The recipient has already spent this money, so it cannot be reversed');
          throw e;
        }
        return { ok: true, txn };
      },
    },
  ],
});
