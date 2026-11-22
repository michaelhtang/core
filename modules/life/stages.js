// Pure life arithmetic (docs/phase5-life.md 5b): age and stage from the world month, the pace plan's checks, and the class-day table.
// No I/O, so the module, its tests and scripts/life-pace.mjs share it.
export const START_AGE = 22, END_AGE = 70;
export const RETIRE_MIN = 60, RETIRE_MAX = 70, RETIRE_DEFAULT = 65;
export const SNAPSHOT_AGES = [25, 35, 55, 65, 70];
export const STAGES = [{ stage: 'A', from_age: 0, to_age: 35 }, { stage: 'B', from_age: 36, to_age: 54 }, { stage: 'C', from_age: 55, to_age: END_AGE - 1 }]   // the life is ages 22-69; 70 is the Life Review;
// Months 1-24 at 1 a day, 25-168 at 4, 169-396 at 12, 397-576 at 12: 24 + 36 + 19 + 15 = 94 class days.
export const DEFAULT_PLAN = Object.freeze([{ from_month: 1, months_per_day: 1 }, { from_month: 25, months_per_day: 4 }, { from_month: 169, months_per_day: 12 }, { from_month: 397, months_per_day: 12 }]);

export const ageAt = (month, startAge = START_AGE) => startAge + Math.floor((month - 1) / 12);
export const stageOf = (age) => (age < 36 ? 'A' : age < 55 ? 'B' : 'C');
export const stageNo = (stage) => ' ABC'.indexOf(stage);                    // 1, 2, 3 (the Today fact)
export const monthOfAge = (age, startAge = START_AGE) => 12 * (age - startAge) + 1;   // the first month at that age
// The life is months 1 .. endMonth - 1 (ages startAge-69); the world comes to rest at endMonth (the first month at 70), where the Life Review is ready.
// The last segment of a plan runs up to it, so its length (endMonth - from) is a whole number of class days, like every other segment.
export const endMonth = (startAge = START_AGE) => monthOfAge(END_AGE, startAge);

// A plan, checked: [{ from_month, months_per_day }], from month 1, strictly increasing, before the end, each pace 1..12 and each segment a whole number
// of class days (its length a multiple of its pace), so an advance never straddles a boundary. Returns a clean copy; throws Error(message).
export function checkPlan(plan, startAge = START_AGE) {
  const end = endMonth(startAge);
  if (!Array.isArray(plan) || plan.length < 1 || plan.length > 24) throw new Error('The pace plan must be a list of 1 to 24 segments');
  const out = plan.map((s, i) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`Segment ${i + 1} must be { from_month, months_per_day }`);
    const { from_month: from, months_per_day: pace } = s;
    if (!Number.isSafeInteger(from)) throw new Error(`Segment ${i + 1}: from_month must be a whole number`);
    if (!Number.isSafeInteger(pace) || pace < 1 || pace > 12) throw new Error(`Segment ${i + 1}: months per class day must be 1 to 12`);
    return { from_month: from, months_per_day: pace };
  });
  if (out[0].from_month !== 1) throw new Error('The first segment must start at month 1');
  out.forEach((s, i) => {
    const next = out[i + 1]?.from_month ?? end;
    if (next <= s.from_month) throw new Error(i + 1 < out.length ? `Segment ${i + 2} must start after month ${s.from_month}` : `Segment ${i + 1} must start before month ${end} (age ${END_AGE})`);
    if ((next - s.from_month) % s.months_per_day) throw new Error(`Segment ${i + 1} (months ${s.from_month}-${next - 1}, ${next - s.from_month} months) is not a whole number of class days at ${s.months_per_day} a day`);
  });
  return out;
}

// The segment a month falls in (the last one starting at or before it).
export const segmentAt = (plan, month) => plan.filter((s) => s.from_month <= month).at(-1) ?? plan[0];
// The boundaries an advance from -> month crossed (from < b <= month). Crossing, not equality, so an odd manual advance never skips one for good.
export const crossed = (from, month, list) => list.filter((b) => from < b && b <= month);

// The class-day calculator: per segment, the days it takes and the days it still needs from the world's month; plus the total against the
// teacher's "class days left". currentPace (the world's months_per_day now) applies until the next boundary, or everywhere when the pace is locked.
export function paceTable(plan, { startAge = START_AGE, month = 1, currentPace, locked = false, daysLeft } = {}) {
  const end = endMonth(startAge);
  const rows = plan.map((s, i) => {
    const next = plan[i + 1]?.from_month ?? end;
    const inSeg = month >= s.from_month && month < next;
    const pace = (locked || inSeg) && currentPace ? currentPace : s.months_per_day;
    const left = month >= next ? 0 : Math.ceil((next - Math.max(month, s.from_month)) / pace);
    const fromAge = ageAt(s.from_month, startAge), toAge = ageAt(next - 1, startAge);
    const stages = [...new Set([stageOf(fromAge), stageOf(toAge)])].join('-');
    return { from_month: s.from_month, to_month: next - 1, from_age: fromAge, to_age: toAge, stages, months_per_day: s.months_per_day, days: (next - s.from_month) / s.months_per_day, days_left: left, current: inSeg };
  });
  const total = rows.reduce((t, r) => t + r.days, 0), needed = rows.reduce((t, r) => t + r.days_left, 0);
  return { rows, total_days: total, days_needed: needed, days_left: daysLeft ?? null, spare_days: Number.isSafeInteger(daysLeft) ? daysLeft - needed : null, end_month: end };
}

