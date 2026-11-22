// jobs: config readers, constants and the row reads shared by careers.js, payday.js and index.js.
export const RAISE_BP = 300, PROMO_MONTHS = 12, REAPPLY_MONTHS = 3, SIM_APPROVE_PCT = 10;   // defaults; options.jobs.{raiseBp, promotionMonths, reapplyMonths, simApprovePct (bots only)}
export const cfg = (k, key, dflt, lo, hi) => (Number.isSafeInteger(k.config[key]) && k.config[key] >= lo && k.config[key] <= hi ? k.config[key] : dflt);
export const raiseBp = (k) => cfg(k, 'raiseBp', RAISE_BP, 0, 2000);
export const promoMonths = (k) => cfg(k, 'promotionMonths', PROMO_MONTHS, 1, 120);
export const reapplyMonths = (k) => cfg(k, 'reapplyMonths', REAPPLY_MONTHS, 0, 24);
export const raised = (cents, bp) => Math.round((cents * (10000 + bp)) / 10000);
// options.jobs.autoPromote (default off; the life wave turns it on, docs/phase5-life.md 5b): a step after the first promotion of a career (the holding is past
// step 0) needs no teacher. The student still applies with the reflection once eligible and is promoted at once; a denial's cool-off does not apply.
// The first promotion (step 0 -> 1) is always the teacher's decision.
export const autoStep = (k, h) => k.config.autoPromote === true && h.step >= 1;
// The world price index (k.world.priceIndex(); 10000 = none, also when rates is not loaded). Catalogue and promotion-step wages are paid at
// wage x index to NEW hires and promotions; a holding's own wage_cents only moves by raises and promotions (a raise stays raiseBp), never by the index.
export const px = (k, cents) => Math.round((cents * k.world.priceIndex()) / 10000);

// A holding with the position it is in now: step 0 is the catalogue entry, step n the n-th row of jobs_steps. wage_cents (a raise) overrides the step's wage.
export const HOLD_SQL = `SELECT h.player_id, h.job_id, h.since_month, h.step, h.wage_cents, h.step_since, h.raise_since, h.note,
    COALESCE(s.title, c.title) AS title, c.employer, COALESCE(h.wage_cents, s.hourly_cents, c.hourly_cents) AS hourly_cents,
    COALESCE(s.hours_per_month, c.hours_per_month) AS hours_per_month
  FROM jobs_holdings h JOIN jobs_catalogue c ON c.id = h.job_id LEFT JOIN jobs_steps s ON s.job_id = h.job_id AND s.step = h.step`;
export const holdOf = (k, playerId) => k.db.prepare(`${HOLD_SQL} WHERE h.player_id = ?`).get(playerId);
export const bizOf = (k, playerId) => k.db.prepare('SELECT * FROM jobs_business WHERE player_id = ? ORDER BY since_month, business_id').all(playerId);   // 0-2 business jobs
export const bizAt = (k, playerId, businessId) => k.db.prepare('SELECT * FROM jobs_business WHERE player_id = ? AND business_id = ?').get(playerId, businessId);
export const MISSED_TO_LEAVE = 2;   // missed paydays after which the board tells the student they may quit (they may at any time)
export const nextStepOf = (k, h) => k.db.prepare('SELECT * FROM jobs_steps WHERE job_id = ? AND step = ?').get(h.job_id, h.step + 1);
