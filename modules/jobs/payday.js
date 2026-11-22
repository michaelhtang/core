// jobs: payday (catalogue and company pay, T4127 stubs, raises), the pay-stub view and the catalogue board read.
import { money as dollars } from '../../lib/kernel.js';
import { payStub, employerShare } from './payroll.js';
import { raiseBp, raised, px, HOLD_SQL, MISSED_TO_LEAVE } from './reads.js';

const periodOf = (month) => ((month - 1) % 12) + 1;           // 1..12; world months 1-12 are year 1, 13-24 year 2, ...
const yearOf = (month) => Math.ceil(month / 12);

export const catalogueFor = (k, classId) => k.db.prepare(`SELECT c.id, c.title, c.employer, c.hourly_cents, c.hours_per_month,
    c.requires_note, c.alis_url, c.checked FROM jobs_catalogue c
  WHERE c.active = 1 AND c.id NOT IN (SELECT job_id FROM jobs_class_off WHERE class_id = ?) ORDER BY c.id`).all(classId)
  .map((c) => { const hourly = px(k, c.hourly_cents); return { ...c, hourly_cents: hourly, gross_cents: hourly * c.hours_per_month }; });   // what a new hire earns now

// Year to date (this world, this calendar year, months before `month`, or up to and including it) for each player, in cents.
export function ytdFor(k, worldId, month, ids, inclusive = false) {
  const first = month - periodOf(month) + 1;
  const rows = k.db.prepare(`SELECT player_id, SUM(gross) AS gross, SUM(cpp) AS cpp, SUM(cpp2) AS cpp2, SUM(ei) AS ei, SUM(federal_tax) AS federalTax, SUM(alberta_tax) AS albertaTax, SUM(net) AS net
    FROM jobs_paystubs WHERE world_id = ? AND month >= ? AND month ${inclusive ? '<=' : '<'} ? AND player_id IN (SELECT value FROM json_each(?)) GROUP BY player_id`).all(worldId, first, month, JSON.stringify(ids));
  return new Map(rows.map((r) => [r.player_id, r]));
}

const STUB_INSERT = `INSERT INTO jobs_paystubs (player_id, world_id, month, job_id, gross, cpp, cpp2, ei, federal_tax, alberta_tax, net, ytd_json, txn_id, step, title, employer, hourly_cents, hours, note, business_id, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

// One business pay (kind 'pay' at payday, 'severance' = one month's wages in lieu of notice): the same T4127 stub as a catalogue job, funded by
// the ventures payroll service (treasury -> net to chequing, deductions + the employer's CPP and EI to the sink). Returns the service's answer
// with the stub (`stub`); { paid: false } writes nothing here. The caller emits module.jobs.paid. Each stub's tax is worked out on its own
// period's gross with the year to date before this month (`ytd`): two employers each withhold as if they were the only one, as in real life.
export function payBusiness(k, world, b, month, kind, ytd) {
  const s = payStub({ grossCents: b.hourly_cents * b.hours_per_month, period: periodOf(month), ytd });
  const er = employerShare(s);
  const r = k.modules.has('ventures')
    ? k.modules.call('ventures', 'payroll', { businessId: b.business_id, playerId: b.player_id, grossCents: s.gross, netCents: s.net, employerCppCents: er.cpp, employerEiCents: er.ei, month, kind })
    : { paid: false, reason: 'Venture Row is not open' };
  if (!r.paid) return r;
  const note = kind === 'severance' ? 'Pay in lieu of notice: one month\'s wages, because your job ended without notice.' : b.note;
  k.db.prepare(STUB_INSERT).run(b.player_id, world.id, month, null, s.gross, s.cpp, s.cpp2, s.ei, s.federalTax, s.albertaTax, s.net, JSON.stringify(s.ytd), r.txnId, 0, b.title, r.employer ?? b.employer, b.hourly_cents, b.hours_per_month, note, b.business_id, kind);
  if (b.note && kind === 'pay') k.db.prepare("UPDATE jobs_business SET note = '' WHERE player_id = ? AND business_id = ?").run(b.player_id, b.business_id);
  return { ...r, stub: s };
}

// One pass per student (each in its own savepoint): the catalogue pay, then each business job, then ONE module.jobs.paid with the month's
// totals (listeners that keep "the last pay" see the whole month; the additive ones see the same sum). A second run for the same month is a
// no-op per source: a catalogue stub, or that company's stub (or its miss), already there.
export function payday(k, month, studentIds) {
  if (!studentIds.length) return;
  const world = k.world.current();
  const ids = JSON.stringify(studentIds);
  const due = new Map(k.db.prepare(`${HOLD_SQL} WHERE h.player_id IN (SELECT value FROM json_each(?))
    AND h.player_id NOT IN (SELECT player_id FROM jobs_paystubs WHERE world_id = ? AND month = ? AND kind = 'pay' AND business_id IS NULL)`).all(ids, world.id, month).map((d) => [d.player_id, d]));
  const biz = new Map();
  for (const b of k.db.prepare(`SELECT b.* FROM jobs_business b WHERE b.player_id IN (SELECT value FROM json_each(?)) AND (b.last_missed IS NULL OR b.last_missed <> ?)
    AND NOT EXISTS (SELECT 1 FROM jobs_paystubs s WHERE s.player_id = b.player_id AND s.world_id = ? AND s.month = ? AND s.kind = 'pay' AND s.business_id = b.business_id)
    ORDER BY b.player_id, b.since_month, b.business_id`).all(ids, month, world.id, month)) (biz.get(b.player_id) ?? biz.set(b.player_id, []).get(b.player_id)).push(b);
  const who = [...new Set([...due.keys(), ...biz.keys()])].sort((a, b) => a - b);
  if (!who.length) return;
  const ytds = ytdFor(k, world.id, month, who);
  k.db.prepare('INSERT OR IGNORE INTO jobs_year_index (world_id, year, index_bp) VALUES (?, ?, ?)').run(world.id, yearOf(month), k.world.priceIndex(world.id));   // once a year (5c)
  const mint = k.ledger.system('mint');
  const sink = k.ledger.system('sink');
  const bp = raiseBp(k);
  const insert = k.db.prepare(STUB_INSERT);
  const settle = k.db.prepare("UPDATE jobs_holdings SET wage_cents = ?, raise_since = ?, note = '' WHERE player_id = ?");
  k.db.txn((tx) => {
    k.forEachPlayer(who, (pid) => {                                       // one student's pay in its own savepoint (docs/modules.md section 5)
      const chequing = k.ledger.accountId('player', pid, 'chequing');
      if (!chequing) return;
      let gross = 0, net = 0, paid = false;
      const d = due.get(pid);
      if (d) {
        let wage = d.hourly_cents, raise = d.raise_since, note = d.note;      // a promotion note was written when the promotion was granted
        // The first raise comes with the 13th pay (a full year of pays at the starting wage: pays begin the month after the job starts), then every 12 months.
        if (bp > 0 && (d.raise_since != null ? month - d.raise_since >= 12 : month - d.since_month >= 13)) {
          wage = raised(wage, bp); raise = month;
          note = [note, `Annual raise of ${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%: ${dollars(d.hourly_cents)} to ${dollars(wage)} an hour.`].filter(Boolean).join(' ');
        }
        if (wage !== d.hourly_cents || note) settle.run(wage === d.hourly_cents ? d.wage_cents : wage, raise ?? null, pid);
        const s = payStub({ grossCents: wage * d.hours_per_month, period: periodOf(month), ytd: ytds.get(pid) });
        const deductions = s.cpp + s.cpp2 + s.ei + s.federalTax + s.albertaTax;
        const txn = k.ledger.post({
          kind: 'pay', actor: 'system', meta: { worldId: world.id, month, jobId: d.job_id },
          legs: [
            { account: mint, cents: -s.gross, memo: `Pay, month ${month}` },
            { account: chequing, cents: s.net, memo: `Pay, month ${month}` },
            ...(deductions ? [{ account: sink, cents: deductions, memo: `Payroll deductions, month ${month}` }] : []),
          ],
        });
        insert.run(pid, world.id, month, d.job_id, s.gross, s.cpp, s.cpp2, s.ei, s.federalTax, s.albertaTax, s.net, JSON.stringify(s.ytd), txn, d.step, d.title, d.employer, wage, d.hours_per_month, note, null, 'pay');
        gross += s.gross; net += s.net; paid = true;
      }
      for (const b of biz.get(pid) ?? []) {
        const r = payBusiness(k, world, b, month, 'pay', ytds.get(pid));
        if (r.paid) { gross += r.stub.gross; net += r.stub.net; paid = true; } else {
          const missed = b.missed + 1;
          k.db.prepare('UPDATE jobs_business SET missed = ?, last_missed = ?, note = ? WHERE player_id = ? AND business_id = ?')
            .run(missed, month, `${b.employer} could not make payroll in month ${month}: you were not paid for these hours.${missed >= MISSED_TO_LEAVE ? ` It has missed ${missed} paydays: you may quit this job (your Job Centre job is not affected).` : ''}`, pid, b.business_id);
          // module.jobs.unpaid: the student's notice (after commit)
          k.db.txn((t) => t.onCommit(() => k.events.emit('unpaid', { playerId: pid, worldId: world.id, month, employer: b.employer, businessId: b.business_id, missed })));
        }
        if (b.ends_month !== null && month >= b.ends_month) k.db.prepare('DELETE FROM jobs_business WHERE player_id = ? AND business_id = ?').run(pid, b.business_id);   // the notice ran out: that was the last pay
      }
      // module.jobs.paid, emitted synchronously (inside this transaction, on purpose): a listener's writes commit or roll back with the pay.
      if (paid) k.events.emit('paid', { playerId: pid, worldId: world.id, month, net, gross });
    }, (pid) => pid);
    tx.onCommit(() => k.events.emit('payday', { month }));   // module.jobs.payday: teacher consoles refetch
  });
}

export const stubView = (r) => ({
  id: r.id, month: r.month, period: periodOf(r.month), year: yearOf(r.month), kind: r.kind,
  job: { id: r.job_id, title: r.title, employer: r.employer, hourly_cents: r.hourly_cents, hours: r.hours_per_month, step: r.step },
  note: r.note,
  employee: r.username,
  gross: r.gross, cpp: r.cpp, cpp2: r.cpp2, ei: r.ei, federal_tax: r.federal_tax, alberta_tax: r.alberta_tax, net: r.net,
  deductions: r.cpp + r.cpp2 + r.ei + r.federal_tax + r.alberta_tax,
  ytd: JSON.parse(r.ytd_json),
});
