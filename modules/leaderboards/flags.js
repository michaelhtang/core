// Pattern flags (docs/phase6-roles.md §1.3): what one student's season says, each with the number behind it. From leaderboards' own tables only
// (snapshots, inputs, late) and life's `snapshots` service: never the live ledger, because at season close (where the finale stores them) every
// account has already been zeroed. Returns only the flags that hold: [{ key, text, detail }]. The same function answers the teacher's live route.
import { GOUGE_PCT, GOUGE_MONTHS } from './constants.js';

const SHORT_AGE = 90;   // retirement_short: the docs/phase5-life.md 5c line

const pct = (x) => `${Math.round(x * 100)}%`;
const dollars = (c) => `$${Math.round(c / 100).toLocaleString('en-CA')}`;

export function flags(k, { worldId, playerId }) {
  const snaps = k.db.prepare('SELECT month, class_id, parts, rank_class, chequing, saved, holdings, net_pay FROM leaderboards_snapshots WHERE world_id = ? AND player_id = ? ORDER BY month').all(worldId, playerId);
  if (!snaps.length) return [];
  const inp = k.db.prepare('SELECT * FROM leaderboards_inputs WHERE world_id = ? AND player_id = ?').get(worldId, playerId) ?? {};
  const late = k.db.prepare('SELECT COUNT(*) AS n FROM leaderboards_late WHERE world_id = ? AND player_id = ?').get(worldId, playerId).n;
  const last = snaps.at(-1), parts = (r) => JSON.parse(r.parts);
  const out = [];
  const flag = (key, text, detail) => out.push({ key, text, detail });

  // 1. Hoards cash: chequing over 3 x net pay while HISA + GIC + holdings are under 1 x net pay, in 6 or more of the last 12 months (months with pay).
  const recent = snaps.slice(-12).filter((r) => r.chequing != null && r.net_pay > 0);
  const hoard = recent.filter((r) => r.chequing > 3 * r.net_pay && r.saved + (r.holdings ?? 0) < r.net_pay).length;
  if (hoard >= 6) flag('hoards_cash', 'Tends to hoard cash', `${hoard} of the last 12 months with chequing over 3 months of pay and savings under 1 month`);

  // 2. Excessive debt: the debt-load part under 40 in 3 or more months, or two emergency loans.
  const heavy = snaps.filter((r) => parts(r).load < 40).length, loans = inp.loans ?? 0;
  if (heavy >= 3 || loans >= 2) flag('excessive_debt', 'Took on excessive debt', [heavy ? `debt load under 40 in ${heavy} month${heavy === 1 ? '' : 's'}` : null, loans >= 2 ? `${loans} emergency loans` : null].filter(Boolean).join('; '));

  // 3. Never invested: no holdings in any snapshot, no contribution to an investment account, TFSA or RRSP, and (with life) no equities at 35.
  // Only with the exchange loaded and the 6a snapshot columns there (older months have no holdings figure).
  if (k.modules.has('exchange') && snaps.some((r) => r.holdings != null) && !snaps.some((r) => r.holdings > 0) && !inp.invested) {
    let eq35 = 0;
    if (k.modules.has('life')) {
      try { const rows = k.modules.call('life', 'snapshots', { playerId, worldId }); eq35 = (Array.isArray(rows) && rows.find((r) => r?.age === 35)?.allocation?.equities) || 0; } catch { /* no life data: holdings decide */ }
    }
    if (!(eq35 > 0)) flag('never_invested', 'Never invested', `no holdings and no contributions in ${snaps.length} months`);
  }

  // 4. Paid every bill on time: nothing late, and at least 12 on-time payments (bills, card minimums and mortgage payments together).
  if (late === 0 && (inp.ontime ?? 0) >= 12) flag('always_on_time', 'Paid every bill on time', `${inp.ontime} on-time payments, none late`);

  // 5. House-poor: owns, the mortgage payment is over 35% of gross pay, and the savings cushion is under 30.
  const cushion = parts(last).cushion, pay = inp.mortgage_payment ?? 0, gross = inp.gross_cents ?? 0;
  if ((inp.home_value ?? 0) > 0 && pay > 0 && (gross <= 0 || pay > 0.35 * gross) && cushion < 30) {
    flag('house_poor', 'House-poor', `mortgage ${dollars(pay)}/month is ${gross > 0 ? `${pct(pay / gross)} of gross pay` : 'paid with no income'}; savings cushion ${cushion}`);
  }

  // 6. Late bloomer: class rank from month 12 to the end improved by 10 or more places, or by a third of the class.
  const at12 = snaps.find((r) => r.month >= 12);
  if (at12 && last.month > at12.month) {
    const size = k.db.prepare('SELECT COUNT(*) AS n FROM leaderboards_snapshots WHERE world_id = ? AND month = ? AND class_id = ?').get(worldId, last.month, last.class_id).n;
    const up = at12.rank_class - last.rank_class;
    if (up > 0 && (up >= 10 || up * 3 >= size)) flag('late_bloomer', 'Late bloomer', `class rank #${at12.rank_class} at month ${at12.month} to #${last.rank_class} of ${size} at month ${last.month}`);
  }
  // 7. Rent gouger (6b): a unit let at >= 140% of the NPC rent tier, with a tenant, for 6 or more months (counted from housing's rent payment events).
  if ((inp.gouge_months ?? 0) >= GOUGE_MONTHS) flag('rent_gouger', 'Rent gouger', `${inp.gouge_months} months renting to a classmate at ${GOUGE_PCT}% or more of the going rent`);
  // 8. Missed payroll (6c): a company this student founded (holds shares in) could not pay its staff at least once this season. From
  // module.ventures.value's missedPaydays (the company's count, which never goes down in a season), kept in leaderboards_inputs.ventures_missed.
  if ((inp.ventures_missed ?? 0) > 0) flag('missed_payroll', 'Missed payroll', `their company missed ${inp.ventures_missed} pay${inp.ventures_missed === 1 ? '' : 's'} to its staff`);
  // 9. Retirement short (5c): the retirement module's last projection (module.retirement.coverage, Stage C) says the savings run out before 90.
  if (inp.lasts_age != null && inp.lasts_age < SHORT_AGE) flag('retirement_short', 'Will run out before 90', `savings projected to last until age ${inp.lasts_age} on their draw plan and bills`);
  return out;
}
