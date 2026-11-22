// jobs: the Job Centre and monthly payroll (docs/phase1.md 1A). A student holds at most one job from the catalogue; each world month
// ("payday") every student with a job is paid in ONE ledger transaction: the employer is outside the town, so the gross is minted, the
// net lands in chequing and the deductions (CPP, CPP2, EI, federal and Alberta income tax) go straight to the sink. The deductions are
// computed from CRA T4127 (payroll.js). Picking, switching or quitting only changes the holding; money moves at payday, so it takes
// effect at the next payday by construction.
// Raises and promotions (docs/jobs.md): the wage lives on the holding, not the catalogue, so raises are individual. After every 12 months in the same
// job (or since the last raise or promotion) payday gives a raise (default +3%); each job has a 1-3 step promotion path (jobs_steps). A student who
// has been 12 months in a step may apply with a short reflection; the teacher approves or denies (or, with options.jobs.autoPromote, every step after the
// first promotion of a career is granted at once). A new season puts everyone back on the entry wage.
// Business jobs (docs/phase4.md 4b, docs/phase6-roles.md 6c): a student company (ventures) hires through the hireForBusiness service. A business
// job is PART-TIME paid hours ON TOP of the catalogue job (jobs_holdings, wages minted): jobs_business holds up to 2 per student (10-40 h/month
// each, 40 h in all, wages from the company's treasury), and hiring never touches the catalogue job. Payday pays each source with its own T4127
// stub (the catalogue job's minted pay; each business job through the ventures `payroll` service: treasury -> net to chequing, deductions and
// the employer's CPP and EI to the sink; nothing minted) and emits ONE module.jobs.paid per student with the month's totals. A treasury that
// cannot pay: no pay from it that month (no stub), module.jobs.unpaid; after 2 missed paydays the board says so and the student may quit it
// (POST /quit-business: any time, as in 4b). Retirement (endHolding) ends the catalogue job and every business job.
// Services: hireForBusiness, endBusinessJob (notice, or now with one month's wages as pay in lieu of notice), staffOf.
// Files: index.js (the module definition: services, season close, tick and bots, routes), migrations.js (table migrations), reads.js (config readers and
// row reads), careers.js (promotion path, hire, leave, apply, decide, Today facts, retirement), payday.js (monthly pay, stubs, catalogue board);
// catalogue.js (the jobs and their promotion paths), payroll.js (T4127 deductions), ui/ (the panels).
import { defineModule } from '../../lib/modules.js';
import { money as dollars, ok } from '../../lib/kernel.js';
import { YMPE, CPP_EXEMPTION_ANNUAL } from './payroll.js';
import { CATALOGUE, PATHS, MIN_WAGE_CENTS, BUSINESS_MIN_HOURS, BUSINESS_MAX_HOURS, BUSINESS_MAX_JOBS } from './catalogue.js';
import { migrations } from './migrations.js';
import { SIM_APPROVE_PCT, cfg, raiseBp, promoMonths, raised, px, HOLD_SQL, holdOf, bizOf, bizAt, MISSED_TO_LEAVE } from './reads.js';
import { standing, promote, announceHire, leave, hold, applyFor, decide, todayFacts, endHolding } from './careers.js';
import { payday, payBusiness, ytdFor, catalogueFor, stubView } from './payday.js';

export default defineModule({
  id: 'jobs',
  options: { raiseBp: 'annual raise, bp', promotionMonths: 'months in a step before applying', reapplyMonths: 'months after a denial', simApprovePct: 'bots only: approval percent',
    autoPromote: 'true: promotions after the first in a career need no teacher (the life wave)' },
  catalogues: [{ table: 'jobs_catalogue', key: ['id'], rows: () => CATALOGUE }, { table: 'jobs_steps', key: ['job_id', 'step'], rows: () => PATHS }],   // upserted at boot (docs/modules.md "Catalogues")
  requires: ['bank-basic'],

  services: {
    todayFacts, endHolding,
    // The student's own CPP record this season (retirement, docs/phase5-life.md 5c): per world year with a CPP contribution, the gross on every pay stub (the
    // catalogue job, company jobs, pay in lieu), the CPP withheld, the months, and the YMPE and basic exemption of that year x the price index at its first
    // payday (wages rise with the index, so the 2026 YMPE alone would count every later year as a full one). Read-only.
    cppHistory(k, { playerId, worldId } = {}) {
      if (!ok(playerId)) throw new k.HttpError(400, 'playerId must be a whole number');
      const wid = ok(worldId) ? worldId : k.world.current()?.id ?? -1;
      const years = k.db.prepare(`SELECT s.year, s.gross_cents, s.cpp_cents, s.months, COALESCE(i.index_bp, 10000) AS index_bp FROM (
          SELECT (month - 1) / 12 + 1 AS year, SUM(gross) AS gross_cents, SUM(cpp) AS cpp_cents, COUNT(DISTINCT month) AS months FROM jobs_paystubs
          WHERE player_id = ? AND world_id = ? AND cpp > 0 GROUP BY year) s
        LEFT JOIN jobs_year_index i ON i.world_id = ? AND i.year = s.year ORDER BY s.year`).all(playerId, wid, wid)
        .map((y) => ({ ...y, ympe_cents: Math.round((YMPE * y.index_bp) / 10000), exemption_cents: Math.round((CPP_EXEMPTION_ANNUAL * y.index_bp) / 10000) }));
      return { years };
    },
    // Business jobs (wave 4b), for ventures. Each validates what it is given; a refusal is an HttpError the caller passes on.
    // Hire a student into a company's job, ON TOP of their catalogue job (which is never touched): at most BUSINESS_MAX_JOBS (2) business jobs,
    // BUSINESS_MAX_HOURS (40) hours a month in all, one per company; a retired student (life) is refused. ventures checks its own floor
    // (the minimum wage x the price index) before calling; MIN_WAGE_CENTS here is the legal floor the table also checks.
    hireForBusiness(k, { playerId, businessId, employer, title, hourlyCents, hoursPerMonth, month }) {
      if (!ok(playerId) || !k.players.student(playerId)) throw new k.HttpError(404, 'No such student');
      if (k.modules.has('life') && k.modules.call('life', 'retired', { playerId }).retired) throw new k.HttpError(409, 'That student is retired: work stopped at their retirement age');
      if (!ok(businessId) || !ok(month) || typeof employer !== 'string' || !employer || typeof title !== 'string' || !title.trim() || title.length > 60) throw new k.HttpError(400, 'A job needs an employer, a title (up to 60 characters) and a month');
      if (!ok(hourlyCents) || hourlyCents < MIN_WAGE_CENTS) throw new k.HttpError(400, `The wage must be at least Alberta's minimum wage, ${dollars(MIN_WAGE_CENTS)} an hour`);
      if (!ok(hoursPerMonth) || hoursPerMonth < BUSINESS_MIN_HOURS || hoursPerMonth > BUSINESS_MAX_HOURS) throw new k.HttpError(400, `Hours are ${BUSINESS_MIN_HOURS} to ${BUSINESS_MAX_HOURS} a month`);
      return k.db.txn((tx) => {
        const now = bizOf(k, playerId), hours = now.reduce((t, b) => t + b.hours_per_month, 0);
        if (now.some((b) => b.business_id === businessId)) throw new k.HttpError(409, 'That student already works for this company');
        if (now.length >= BUSINESS_MAX_JOBS) throw new k.HttpError(409, `A student holds at most ${BUSINESS_MAX_JOBS} part-time company jobs`);
        if (hours + hoursPerMonth > BUSINESS_MAX_HOURS) throw new k.HttpError(409, `Company jobs are at most ${BUSINESS_MAX_HOURS} hours a month in all: that student already works ${hours}`);
        k.db.prepare('INSERT INTO jobs_business (player_id, business_id, employer, title, hourly_cents, hours_per_month, since_month) VALUES (?, ?, ?, ?, ?, ?, ?)').run(playerId, businessId, employer, title.trim(), hourlyCents, hoursPerMonth, month);
        k.audit('hire', { player: playerId, business: businessId, title: title.trim(), hourlyCents, hoursPerMonth }, 'module:ventures');
        tx.onCommit(() => k.events.emit('assigned', { playerId }));
        return { ok: true };
      });
    },
    // End a business job. mode 'notice': one month's notice (the next payday is the last); 'severance': now, with one month's wages as pay in
    // lieu of notice (refused if the treasury cannot pay it); 'now': now, nothing paid (the company was dissolved).
    endBusinessJob(k, { playerId, businessId, mode, month }) {
      const b = ok(playerId) && ok(businessId) ? bizAt(k, playerId, businessId) : null;
      if (!b) throw new k.HttpError(404, 'That student does not work for this company');
      if (!['notice', 'severance', 'now'].includes(mode) || !ok(month)) throw new k.HttpError(400, 'mode is notice, severance or now');
      return k.db.txn((tx) => {
        if (mode === 'notice') {
          if (b.ends_month !== null) throw new k.HttpError(409, `Notice was already given: the job ends after the month ${b.ends_month} payday`);
          k.db.prepare('UPDATE jobs_business SET ends_month = ?, note = ? WHERE player_id = ? AND business_id = ?').run(month + 1, `${b.employer} gave you one month's notice: your last pay from it is at the month ${month + 1} payday.`, playerId, businessId);
        } else {
          if (mode === 'severance') {
            const w = k.world.current();   // review 6c-3: one pay in lieu per company and month (the stub index would otherwise throw a 500)
            if (k.db.prepare("SELECT 1 FROM jobs_paystubs WHERE player_id = ? AND world_id = ? AND month = ? AND business_id = ? AND kind = 'severance'").get(playerId, w.id, month, businessId)) throw new k.HttpError(409, 'Pay in lieu of notice from this company was already paid this month: give one month\'s notice instead');
            const r = payBusiness(k, w, b, month, 'severance', ytdFor(k, w.id, month, [playerId], true).get(playerId));
            if (!r.paid) throw new k.HttpError(409, `The treasury cannot pay one month's wages plus the employer's CPP and EI. Give one month's notice instead. (${r.reason})`);
            k.events.emit('paid', { playerId, worldId: w.id, month, net: r.stub.net, gross: r.stub.gross });   // pay in lieu of notice is employment income
          }
          k.db.prepare('DELETE FROM jobs_business WHERE player_id = ? AND business_id = ?').run(playerId, businessId);
        }
        k.audit('end_business_job', { player: playerId, business: businessId, mode }, 'module:ventures');
        tx.onCommit(() => k.events.emit('assigned', { playerId }));
        return { ok: true, endsMonth: mode === 'notice' ? month + 1 : month };
      });
    },
    staffOf: (k, { businessId }) => k.db.prepare('SELECT * FROM jobs_business WHERE business_id = ? ORDER BY since_month, player_id').all(businessId)
      .map((b) => ({ playerId: b.player_id, title: b.title, hourlyCents: b.hourly_cents, hoursPerMonth: b.hours_per_month, sinceMonth: b.since_month, missed: b.missed, endsMonth: b.ends_month })),
  },

  migrations,

  // Season close, inside the close transaction (jobs_holdings is not per world, so this must not be skipped): everyone starts the next
  // season on the catalogue entry wage (the job is kept; step, raises and pending applications are not).
  seasonClose(k) {
    k.db.prepare('DELETE FROM jobs_business').run();   // the companies are wound up: their part-time jobs end (the catalogue job never left)
    k.db.prepare("UPDATE jobs_holdings SET since_month = 1, step = 0, wage_cents = NULL, step_since = NULL, raise_since = NULL, note = ''").run();
    k.db.prepare("UPDATE jobs_applications SET status = 'void' WHERE status = 'pending'").run();
    k.db.prepare('DELETE FROM jobs_past').run();   // world months restart: a past job is a new hire again
  },

  panels: [{ id: 'jobs', building: { key: 'job', name: 'Job Centre', icon: 'job' }, src: 'jobs.js' }],
  teacherPanels: [{ id: 'jobs-teach', title: 'Jobs', src: 'teach.js' }],

  onTick(k, { month, classes }) {
    payday(k, month, classes.flatMap((c) => c.studentIds));
  },

  // Bots: every bot without a job takes a catalogue job (not one its class turned off). When a bot is eligible it applies for promotion, and 10% (options.jobs.simApprovePct; 70% doubled the median wage in 5 years, docs/phase2.md Balance) of
  // applications are approved on the spot (no teacher in the sim); a denied bot may reapply after the cool-off. Applying and deciding go through the same functions as
  // POST /apply and /decide. No Math.random here (hash dice), but a sim run is not reproducible as a whole: bills' bots use Math.random and exchange prices a per-world secret.
  simulate(k, { month, students }) {
    const ids = JSON.stringify(students.map((s) => s.id));
    const have = new Set(k.db.prepare('SELECT player_id FROM jobs_holdings WHERE player_id IN (SELECT value FROM json_each(?))').all(ids).map((r) => r.player_id));   // a company job is on top: it does not count
    const jobsOf = new Map();
    k.db.txn(() => {
      // a bot whose company missed 2 paydays quits that company job (POST /quit-business); its catalogue job was never left
      k.db.prepare(`DELETE FROM jobs_business WHERE missed >= ? AND player_id IN (SELECT value FROM json_each(?))`).run(MISSED_TO_LEAVE, ids);
      for (const s of students) {
        if (have.has(s.id)) continue;
        if (!jobsOf.has(s.class_id)) jobsOf.set(s.class_id, catalogueFor(k, s.class_id));
        const jobs = jobsOf.get(s.class_id);
        if (jobs.length) hold(k, s.id, jobs[(s.id * 2654435761 + month) % jobs.length].id, month);
      }
      for (const s of students) {
        const h = holdOf(k, s.id);
        if (!h || !standing(k, h, month).can_apply) continue;
        const approve = (s.id * 31 + month * 17) % 100 < cfg(k, 'simApprovePct', SIM_APPROVE_PCT, 0, 100);
        const id = applyFor(k, s, 'I have learned the job and I am ready for more responsibility.', month);
        decide(k, k.db.prepare('SELECT * FROM jobs_applications WHERE id = ?').get(id), approve, month, 'system:sim');
      }
    });
  },

  routes: [
    // ---- student ----
    {
      method: 'GET', path: '/catalogue', access: 'student',
      handler(k, { user }) {
        const month = k.world.current().month;
        const h = holdOf(k, user.id), bs = bizOf(k, user.id);
        const entry = h && k.db.prepare('SELECT id, title, hourly_cents, hours_per_month, alis_url, requires_note AS note FROM jobs_catalogue WHERE id = ?').get(h.job_id);
        const used = bs.reduce((t, b) => t + b.hours_per_month, 0);
        return {
          jobs: catalogueFor(k, user.class_id),
          mine: h ? { job_id: h.job_id, since_month: h.since_month } : null,
          // part-time jobs at student companies (4b/6c), on top of the job above: paid from each company's treasury; missed = paydays it could not pay
          business: bs.map((b) => ({ business_id: b.business_id, title: b.title, employer: b.employer, hourly_cents: b.hourly_cents, hours_per_month: b.hours_per_month, gross_cents: b.hourly_cents * b.hours_per_month,
            since_month: b.since_month, missed: b.missed, ends_month: b.ends_month, note: b.note, unpaid_warning: b.missed >= MISSED_TO_LEAVE })),
          business_room: { jobs_left: Math.max(0, BUSINESS_MAX_JOBS - bs.length), hours_left: Math.max(0, BUSINESS_MAX_HOURS - used), max_jobs: BUSINESS_MAX_JOBS, max_hours: BUSINESS_MAX_HOURS },
          // what the student is paid now (the step and any raises), the whole path (step 0 is the entry job), and where they stand on it
          current: h ? { step: h.step, title: h.title, employer: h.employer, hourly_cents: h.hourly_cents, hours_per_month: h.hours_per_month, gross_cents: h.hourly_cents * h.hours_per_month, pending_note: h.note } : null,
          path: h ? [{ step: 0, ...entry, hourly_cents: px(k, entry.hourly_cents) }, ...k.db.prepare('SELECT step, title, hourly_cents, hours_per_month, alis_url, note FROM jobs_steps WHERE job_id = ? ORDER BY step').all(h.job_id).map((r) => ({ ...r, hourly_cents: px(k, r.hourly_cents) }))] : [],
          promotion: h ? { ...standing(k, h, month), months_needed: promoMonths(k), raise_bp: raiseBp(k) } : null,
          month,
        };
      },
    },
    {
      method: 'POST', path: '/apply', access: 'student',
      handler(k, { user, body }) {
        const reflection = k.input.str(body, 'reflection', { max: 500 }).trim();
        if (reflection.length < 10) throw new k.HttpError(400, 'Write a sentence or two about what you have learned and why you are ready');
        const id = applyFor(k, user, reflection, k.world.current().month);
        const a = k.db.prepare('SELECT status, auto FROM jobs_applications WHERE id = ?').get(id);
        return { ok: true, promoted: a.status === 'approved' && a.auto === 1, ...(a.auto === 1 && { title: holdOf(k, user.id)?.title }) };
      },
    },
    {
      method: 'POST', path: '/pick', access: 'student',
      handler(k, { user, body }) {
        const jobId = k.input.int(body, 'job_id', { min: 1 });
        if (!catalogueFor(k, user.class_id).some((j) => j.id === jobId)) throw new k.HttpError(404, 'That job is not on the board for your class');
        // retired (life): work stopped at the retirement payday, and a new job would be paid once before the next payday ended it again
        if (k.modules.has('life') && k.modules.call('life', 'retired', { playerId: user.id }).retired) throw new k.HttpError(409, 'You are retired: work stopped at your retirement age');
        const month = k.world.current().month;
        k.db.txn((tx) => {
          const same = holdOf(k, user.id)?.job_id === jobId;   // re-taking the job held changes nothing, so announces nothing
          hold(k, user.id, jobId, month);
          k.audit('pick', { job: jobId }, `player:${user.id}`);
          if (!same) announceHire(k, tx, user.id, jobId);
        });
        return { ok: true };
      },
    },
    {
      // Quit one part-time company job (any time; the board points to it once the company has missed 2 paydays). The Job Centre job is untouched.
      method: 'POST', path: '/quit-business', access: 'student',
      handler(k, { user, body }) {
        const businessId = k.input.int(body, 'business_id', { min: 1 });
        k.world.active();
        k.db.txn((tx) => {
          const b = bizAt(k, user.id, businessId);
          if (!b) throw new k.HttpError(404, 'You do not work for that company');
          k.db.prepare('DELETE FROM jobs_business WHERE player_id = ? AND business_id = ?').run(user.id, businessId);
          k.audit('quit_business', { business: businessId, missed: b.missed }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('assigned', { playerId: user.id }));
        });
        return { ok: true };
      },
    },
    {
      method: 'POST', path: '/quit', access: 'student',
      handler(k, { user }) {
        k.db.txn(() => {
          if (leave(k, user.id, k.world.current().month)) k.audit('quit', {}, `player:${user.id}`);
        });
        return { ok: true };
      },
    },
    {
      method: 'GET', path: '/stubs', access: 'student',
      handler: (k, { user }) => ({
        stubs: k.db.prepare(`SELECT s.id, s.month, s.gross, s.net, COALESCE(s.title, c.title) AS title, COALESCE(s.employer, c.employer) AS employer, s.note, s.kind FROM jobs_paystubs s LEFT JOIN jobs_catalogue c ON c.id = s.job_id
          WHERE s.player_id = ? ORDER BY s.id DESC LIMIT 240`).all(user.id),
      }),
    },
    {
      method: 'GET', path: '/stubs/:id', access: 'student',
      handler(k, { user, params }) {
        const row = k.db.prepare(`SELECT s.id, s.month, s.job_id, s.step, s.note, s.kind, s.gross, s.cpp, s.cpp2, s.ei, s.federal_tax, s.alberta_tax, s.net, s.ytd_json, COALESCE(s.title, c.title) AS title, COALESCE(s.employer, c.employer) AS employer, COALESCE(s.hourly_cents, c.hourly_cents) AS hourly_cents, COALESCE(s.hours, c.hours_per_month) AS hours_per_month, ? AS username FROM jobs_paystubs s LEFT JOIN jobs_catalogue c ON c.id = s.job_id
          WHERE s.id = ? AND s.player_id = ?`).get(user.username, k.input.idParam(params.id), user.id);   // only your own
        if (!row) throw new k.HttpError(404, 'Pay stub not found');
        return stubView(row);
      },
    },

    // ---- teacher ----
    {
      method: 'GET', path: '/overview', access: 'teacher',
      handler(k, { user }) {
        const classes = k.players.classesFor(user);
        const month = k.world.current().month;
        // the last month paid: the sum of that month's stubs (the catalogue job and any company jobs)
        const last = k.db.prepare(`SELECT s.player_id, SUM(s.net) AS net, s.month FROM jobs_paystubs s
          JOIN (SELECT player_id, MAX(month) AS m FROM jobs_paystubs WHERE player_id IN (SELECT value FROM json_each(?)) GROUP BY player_id) t ON t.player_id = s.player_id AND t.m = s.month GROUP BY s.player_id`);
        const holds = k.db.prepare(`${HOLD_SQL} WHERE h.player_id IN (SELECT value FROM json_each(?))`);
        const apps = k.db.prepare("SELECT id, player_id, job_id, from_step, month, reflection FROM jobs_applications WHERE status = 'pending' AND player_id IN (SELECT value FROM json_each(?)) ORDER BY id");
        const stepTitle = k.db.prepare('SELECT title FROM jobs_steps WHERE job_id = ? AND step = ?');
        const titleAt = (jobId, step) => (step === 0 ? k.db.prepare('SELECT title FROM jobs_catalogue WHERE id = ?').get(jobId)?.title : stepTitle.get(jobId, step)?.title) ?? '';
        const promoted = k.db.prepare("SELECT id, player_id, job_id, from_step, month, decided_month, reflection, auto FROM jobs_applications WHERE status = 'approved' AND player_id IN (SELECT value FROM json_each(?)) ORDER BY id DESC LIMIT 10");
        return {
          catalogue: k.db.prepare('SELECT id, title, hourly_cents, hours_per_month FROM jobs_catalogue WHERE active = 1 ORDER BY id').all(),
          month, raise_bp: raiseBp(k), months_needed: promoMonths(k), auto_promote: k.config.autoPromote === true,
          classes: classes.map((c) => {
            const students = k.players.inClass(c.id);
            const ids = JSON.stringify(students.map((s) => s.id));
            const lastBy = new Map(last.all(ids).map((r) => [r.player_id, r]));
            const held = new Map(holds.all(ids).map((r) => [r.player_id, r]));
            const atBiz = new Map();
            for (const r of k.db.prepare('SELECT player_id, title, employer, hourly_cents, hours_per_month FROM jobs_business WHERE player_id IN (SELECT value FROM json_each(?)) ORDER BY since_month').all(ids)) (atBiz.get(r.player_id) ?? atBiz.set(r.player_id, []).get(r.player_id)).push(r);
            const name = new Map(students.map((s) => [s.id, s.username]));
            return {
              id: c.id, name: c.name,
              off: k.db.prepare('SELECT job_id FROM jobs_class_off WHERE class_id = ? ORDER BY job_id').all(c.id).map((r) => r.job_id),
              applications: apps.all(ids).map((a) => ({ id: a.id, player_id: a.player_id, username: name.get(a.player_id), month: a.month, reflection: a.reflection,
                from: held.get(a.player_id)?.title ?? '', to: stepTitle.get(a.job_id, a.from_step + 1)?.title ?? '' })),
              // the newest approved promotions, the teacher's and the automatic ones (options.jobs.autoPromote): every automatic promotion is listed here
              promotions: promoted.all(ids).map((a) => ({ id: a.id, player_id: a.player_id, username: name.get(a.player_id), month: a.decided_month ?? a.month, reflection: a.reflection, auto: !!a.auto,
                from: titleAt(a.job_id, a.from_step), to: titleAt(a.job_id, a.from_step + 1) })),
              students: students.map((s) => {
                const h = held.get(s.id);
                const st = h ? standing(k, h, month) : null;
                const bz = atBiz.get(s.id) ?? [];
                return { id: s.id, username: s.username, job_id: h?.job_id ?? null, last_net: lastBy.get(s.id)?.net ?? null, last_month: lastBy.get(s.id)?.month ?? null,
                  step: h?.step ?? null, title: h?.title ?? null, hourly_cents: h?.hourly_cents ?? null, months_in_step: st?.months_in_step ?? null,
                  business: bz.map((b) => `${b.title} at ${b.employer}, ${b.hours_per_month} h`),   // part-time company jobs, on top
                  next: st?.next?.title ?? null, eligible_month: st?.eligible_month ?? null, pending: !!st?.pending };
              }),
            };
          }),
        };
      },
    },
    {
      method: 'POST', path: '/assign', access: 'teacher',
      handler(k, { user, body }) {
        const playerId = k.input.int(body, 'player_id', { min: 1 });
        const jobId = k.input.int(body, 'job_id', { min: 1, optional: true });     // missing or null: remove the job
        k.policy.assert(user, 'player.manage', { playerId });
        if (jobId !== undefined && k.db.prepare('SELECT 1 FROM jobs_holdings WHERE player_id = ? AND job_id = ?').get(playerId, jobId)) return { ok: true };   // already holds it (even if since retired): nothing to change
        if (jobId !== undefined && !k.db.prepare('SELECT 1 FROM jobs_catalogue WHERE id = ? AND active = 1').get(jobId)) throw new k.HttpError(404, 'No such job');
        if (jobId !== undefined && k.modules.has('life') && k.modules.call('life', 'retired', { playerId }).retired) throw new k.HttpError(409, 'That student is retired: work stopped at their retirement age');
        const month = k.world.active().month;   // 409 between seasons: the season close already reset holdings
        k.db.txn((tx) => {
          if (jobId === undefined) leave(k, playerId, month);
          else { hold(k, playerId, jobId, month); announceHire(k, tx, playerId, jobId); }   // (the already-holds case returned above)
          k.audit('assign', { player: playerId, job: jobId ?? null }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('assigned', { playerId }));   // module.jobs.assigned: consoles refetch
        });
        return { ok: true };
      },
    },
    {
      // Approve or deny a pending promotion application. Approving takes effect at the next payday.
      method: 'POST', path: '/decide', access: 'teacher',
      handler(k, { user, body }) {
        const id = k.input.int(body, 'id', { min: 1 });
        const approve = k.input.bool(body, 'approve');
        const a = k.db.prepare("SELECT * FROM jobs_applications WHERE id = ? AND status = 'pending'").get(id);
        if (!a) throw new k.HttpError(404, 'No such waiting application');
        k.policy.assert(user, 'player.manage', { playerId: a.player_id });
        const month = k.world.active().month;   // 409 between seasons: the season close already reset holdings
        decide(k, a, approve, month, `player:${user.id}`);
        return { ok: true };
      },
    },
    {
      // Teacher override: move a student up one step now, whatever the clock says (a waiting application is approved with it).
      method: 'POST', path: '/promote', access: 'teacher',
      handler(k, { user, body }) {
        const playerId = k.input.int(body, 'player_id', { min: 1 });
        k.policy.assert(user, 'player.manage', { playerId });
        const month = k.world.active().month;   // 409 between seasons: the season close already reset holdings
        k.db.txn((tx) => {
          const h = holdOf(k, playerId);
          if (!h) throw new k.HttpError(409, 'That student does not have a job');
          if (!promote(k, h, month)) throw new k.HttpError(409, 'That student is already at the top of the path');
          k.db.prepare("UPDATE jobs_applications SET status = 'approved', decided_month = ? WHERE player_id = ? AND status = 'pending'").run(month, playerId);
          k.audit('promote', { player: playerId, job: h.job_id, from: h.step }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('assigned', { playerId }));
        });
        return { ok: true };
      },
    },
    {
      // Teacher override: give a raise now (the configured percentage); the 12-month clock restarts from today.
      method: 'POST', path: '/raise', access: 'teacher',
      handler(k, { user, body }) {
        const playerId = k.input.int(body, 'player_id', { min: 1 });
        k.policy.assert(user, 'player.manage', { playerId });
        const month = k.world.active().month;   // 409 between seasons: the season close already reset holdings
        k.db.txn((tx) => {
          const h = holdOf(k, playerId);
          if (!h) throw new k.HttpError(409, 'That student does not have a job');
          const wage = raised(h.hourly_cents, raiseBp(k));
          k.db.prepare('UPDATE jobs_holdings SET wage_cents = ?, raise_since = ?, note = ? WHERE player_id = ?')
            .run(wage, month, [h.note, `Raise from your teacher: ${dollars(h.hourly_cents)} to ${dollars(wage)} an hour.`].filter(Boolean).join(' '), playerId);
          k.audit('raise', { player: playerId, from: h.hourly_cents, to: wage }, `player:${user.id}`);
          tx.onCommit(() => k.events.emit('assigned', { playerId }));
        });
        return { ok: true };
      },
    },
    {
      method: 'POST', path: '/catalogue', access: 'teacher',
      handler(k, { user, body }) {
        const classId = k.input.int(body, 'class_id', { min: 1 });
        const jobId = k.input.int(body, 'job_id', { min: 1 });
        const enabled = k.input.bool(body, 'enabled');
        k.policy.assert(user, 'class.manage', { classId });
        if (!k.db.prepare('SELECT 1 FROM jobs_catalogue WHERE id = ?').get(jobId)) throw new k.HttpError(404, 'No such job');
        k.db.txn(() => {
          if (enabled) k.db.prepare('DELETE FROM jobs_class_off WHERE class_id = ? AND job_id = ?').run(classId, jobId);
          else k.db.prepare('INSERT OR IGNORE INTO jobs_class_off (class_id, job_id) VALUES (?, ?)').run(classId, jobId);
          k.audit('catalogue', { class: classId, job: jobId, enabled }, `player:${user.id}`);
        });
        return { ok: true };
      },
    },
  ],
});
