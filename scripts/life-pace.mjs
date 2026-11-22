// The Life class-day table (docs/phase5-life.md 5b), the same as the teacher console's calculator:
//   npm run life-pace -- --days=85 [--plan='[{"from_month":1,"months_per_day":1},...]'] [--month=1] [--start-age=22]
// Prints each segment's months, ages, pace and class days, the days still needed from --month, and whether --days covers them. Exit 1 on a bad plan.
import { DEFAULT_PLAN, START_AGE, checkPlan, paceTable } from '../modules/life/stages.js';

const arg = (name) => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const num = (name, dflt) => { const v = arg(name); if (v === undefined) return dflt; const n = Number(v); if (!Number.isSafeInteger(n)) { console.error(`--${name} must be a whole number`); process.exit(1); } return n; };

const startAge = num('start-age', START_AGE), month = num('month', 1), days = num('days', undefined);
let plan;
try { plan = checkPlan(arg('plan') === undefined ? DEFAULT_PLAN : JSON.parse(arg('plan')), startAge); } catch (e) { console.error(`bad plan: ${e.message}`); process.exit(1); }
const t = paceTable(plan, { startAge, month, daysLeft: days });

const cols = ['months', 'ages', 'stage', 'months/day', 'class days', 'still needed'];
const rows = t.rows.map((r) => [`${r.from_month}-${r.to_month}`, `${r.from_age}-${r.to_age}`, r.stages, r.months_per_day, r.days, r.days_left].map(String));
rows.push(['total', '', '', '', String(t.total_days), String(t.days_needed)]);
const width = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
const line = (r) => r.map((v, i) => (i >= 3 ? v.padStart(width[i]) : v.padEnd(width[i]))).join('  ');
console.log(line(cols));
for (const r of rows) console.log(line(r));
console.log(t.spare_days === null ? `(pass --days=N for the class days left in the season; the life ends at month ${t.end_month}, age 70)`
  : t.spare_days < 0 ? `${days} class days left: short by ${-t.spare_days}` : `${days} class days left: fits, ${t.spare_days} to spare`);
