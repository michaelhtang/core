// exchange registered accounts: the yearly limits, TFSA and RRSP room, the RRSP tax slip, and contribute / withdraw between chequing and an account
import { money } from '../../lib/kernel.js';
import { TFSA_LIMIT_CENTS, RRSP_LIMIT_CENTS } from './constants.js';
import { yearOf, tfsaRoom, rrspRoom, rrspWithheld, rrspSettle } from './orders.js';
import { annualIncomeTax, oasRecoveryTax, OAS_RECOVERY_THRESHOLD } from '../jobs/payroll.js';   // pure tax maths, no tables: the one cross-module import (docs/modules.md)
import { stmt, ACCOUNTS, LABEL, openAcct, balOf } from './reads.js';

// ---- the yearly limits ----
// Fixed ($7,000 TFSA, $33,810 RRSP) unless the life module is loaded with rates: then a 48-year life follows the price index as the real limits do. Each world
// year's indexed limits are frozen at that year's first tick (exchange_limits, written in tick() after rates has stepped the index), so the room already
// carried forward never moves when prices rise later. Year 1, or a year with no row (life enabled mid-season), keeps the base figure.
export const indexing = (k) => k.modules.has('life') && k.modules.has('rates');
export function limitsOf(k, wid) {
  if (!indexing(k)) return { tfsa: TFSA_LIMIT_CENTS, rrsp: RRSP_LIMIT_CENTS };
  const rows = new Map(stmt(k, 'SELECT year, tfsa_cents, rrsp_cents FROM exchange_limits WHERE world_id = ?').all(wid).map((r) => [r.year, r]));
  return { tfsa: (y) => rows.get(y)?.tfsa_cents ?? TFSA_LIMIT_CENTS, rrsp: (y) => rows.get(y)?.rrsp_cents ?? RRSP_LIMIT_CENTS };
}
export const limitsIn = (k, wid, year) => { const l = limitsOf(k, wid), at = (x) => (typeof x === 'function' ? x(year) : x); return { tfsa: at(l.tfsa), rrsp: at(l.rrsp) }; };

// ---- the TFSA and the non-registered account ----
export const tfsaRows = (k, pid, wid) => stmt(k, 'SELECT year, contributed_cents AS contributed, withdrawn_cents AS withdrawn FROM exchange_tfsa WHERE player_id = ? AND world_id = ?').all(pid, wid);
export const tfsaRoomOf = (k, pid, wid, year) => tfsaRoom(year, tfsaRows(k, pid, wid), limitsOf(k, wid).tfsa);
// ---- the RRSP: income (from module.jobs.paid), room, and the year's figures ----
export const incomeByYear = (k, pid, wid) => Object.fromEntries(stmt(k, 'SELECT year, gross_cents FROM exchange_income WHERE player_id = ? AND world_id = ?').all(pid, wid).map((r) => [r.year, r.gross_cents]));
export const rrspRoomOf = (k, pid, wid, year) => rrspRoom(year, incomeByYear(k, pid, wid), stmt(k, 'SELECT COALESCE(SUM(contributed_cents), 0) AS n FROM exchange_rrsp WHERE player_id = ? AND world_id = ?').get(pid, wid).n, limitsOf(k, wid).rrsp);
// h = the RRSP withholding plus the withholding on retirement income (5c); p = CPP + OAS received, o = the OAS part (for the recovery tax).
export const rrspYear = (k, pid, wid, year) => stmt(k, `SELECT contributed_cents AS c, withdrawn_cents AS w, withheld_cents + pension_withheld_cents AS h, pension_cents AS p, oas_cents AS o
  FROM exchange_rrsp WHERE player_id = ? AND world_id = ? AND year = ?`).get(pid, wid, year) ?? { c: 0, w: 0, h: 0, p: 0, o: 0 };
// G earned, C contributed, W withdrawn (RRSP and RRIF), H withheld, P retirement income (CPP + OAS, 5c), O the OAS in it, thr the indexed OAS recovery threshold -> the slip.
// Tax is worked out on G - C + W + P with CPP and EI still charged on what was EARNED (a deduction does not cut pay), plus the OAS recovery tax on that net income.
export function slip(G, C, W, H, P = 0, O = 0, thr = OAS_RECOVERY_THRESHOLD) {
  const net = Math.max(0, G - C + W + P), clawback = oasRecoveryTax(net, O, thr);
  const taxBefore = annualIncomeTax(G), taxAfter = annualIncomeTax(net, G) + clawback;
  return { g: G, c: C, w: W, h: H, p: P, clawback, tax_before: taxBefore, tax_after: taxAfter, settle: rrspSettle(taxBefore, taxAfter, H) };
}
// The OAS recovery threshold in today's prices (the OAS itself is paid x the price index, so the threshold moves with it).
export const oasThreshold = (k, wid) => Math.round((OAS_RECOVERY_THRESHOLD * k.world.priceIndex(wid)) / 10000);

export function accountOf(k, body) {
  const a = k.input.str(body, 'account', { max: 10 });
  if (!ACCOUNTS.includes(a)) throw new k.HttpError(400, 'Choose the non-registered account, the TFSA or the RRSP');
  return a;
}
export function contribute(k, user, account, cents) {
  const w = k.world.current();
  if (!w || w.status !== 'active') throw new k.HttpError(409, 'The season is closed');
  return k.db.txn((tx) => {
    const chq = k.ledger.accountId('player', user.id, 'chequing'), have = chq ? k.ledger.balance(chq) : 0;
    if (have < cents) throw new k.HttpError(400, `Not enough in chequing: you have ${money(have)}.`);
    const year = yearOf(w.month);
    if (account === 'tfsa') {
      const room = tfsaRoomOf(k, user.id, w.id, year);
      if (cents > room) throw new k.HttpError(400, `That is over your TFSA room (${money(room)}). Real CRA charges 1% a month on an over-contribution, so the game refuses it up front.`);
      stmt(k, `INSERT INTO exchange_tfsa (player_id, world_id, year, contributed_cents) VALUES (?, ?, ?, ?)
        ON CONFLICT (player_id, world_id, year) DO UPDATE SET contributed_cents = contributed_cents + excluded.contributed_cents`).run(user.id, w.id, year, cents);
    }
    if (account === 'rrsp') {
      const room = rrspRoomOf(k, user.id, w.id, year);
      if (cents > room) throw new k.HttpError(400, year === 1 ? 'You have no RRSP room in world year 1: room comes from last year\'s pay, and there is none yet.' : `That is over your RRSP room (${money(room)}). The real CRA allows a $2,000 buffer and then charges 1% a month, so the game refuses it up front.`);
      stmt(k, `INSERT INTO exchange_rrsp (player_id, world_id, year, contributed_cents) VALUES (?, ?, ?, ?)
        ON CONFLICT (player_id, world_id, year) DO UPDATE SET contributed_cents = contributed_cents + excluded.contributed_cents`).run(user.id, w.id, year, cents);
    }
    const acct = openAcct(k, user.id, account);
    k.ledger.post({ kind: 'contribute', actor: `player:${user.id}`, meta: { account, month: w.month }, legs: [{ account: chq, cents: -cents, memo: `To your ${LABEL[account]}` }, { account: acct, cents, memo: 'Contribution from chequing' }] });
    tx.onCommit(() => k.events.emit('changed', { classId: user.class_id ?? null }));
    return { ok: true, cents, room_cents: account === 'tfsa' ? tfsaRoomOf(k, user.id, w.id, year) : account === 'rrsp' ? rrspRoomOf(k, user.id, w.id, year) : null };
  });
}
export function withdraw(k, user, account, cents, { kind = 'withdraw', actor = `player:${user.id}` } = {}) {
  const w = k.world.current();
  if (!w || w.status !== 'active') throw new k.HttpError(409, 'The season is closed');
  return k.db.txn((tx) => {
    const have = balOf(k, user.id, account);
    if (have < cents) throw new k.HttpError(400, `Only ${money(have)} of cash in that account. Sell something first to free up more.`);
    const year = yearOf(w.month);
    if (account === 'tfsa') stmt(k, `INSERT INTO exchange_tfsa (player_id, world_id, year, withdrawn_cents) VALUES (?, ?, ?, ?)
      ON CONFLICT (player_id, world_id, year) DO UPDATE SET withdrawn_cents = withdrawn_cents + excluded.withdrawn_cents`).run(user.id, w.id, year, cents);
    // An RRSP withdrawal is taxed at source: the withholding goes to the sink and is kept for the year-end settlement. It never gives room back.
    const withheld = account === 'rrsp' ? rrspWithheld(cents) : 0;
    if (account === 'rrsp') stmt(k, `INSERT INTO exchange_rrsp (player_id, world_id, year, withdrawn_cents, withheld_cents) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (player_id, world_id, year) DO UPDATE SET withdrawn_cents = withdrawn_cents + excluded.withdrawn_cents, withheld_cents = withheld_cents + excluded.withheld_cents`).run(user.id, w.id, year, cents, withheld);
    const legs = [{ account: openAcct(k, user.id, account), cents: -cents, memo: 'Withdrawal to chequing' }, { account: k.ledger.accountId('player', user.id, 'chequing'), cents: cents - withheld, memo: `From your ${LABEL[account]}` }];
    if (withheld) legs.push({ account: k.ledger.system('sink'), cents: withheld, memo: 'RRSP tax withheld at source' });
    k.ledger.post({ kind, actor, meta: { account, month: w.month, withheld }, legs });
    tx.onCommit(() => k.events.emit('changed', { classId: user.class_id ?? null }));
    return { ok: true, cents, withheld_cents: withheld, net_cents: cents - withheld, room_cents: account === 'tfsa' ? tfsaRoomOf(k, user.id, w.id, year) : account === 'rrsp' ? rrspRoomOf(k, user.id, w.id, year) : null };
  });
}
