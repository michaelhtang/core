// learn: shared reads: the loaded courses, the road (which levels are open), and the open-attempt row.
import { loadCourses } from './content.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COURSES = loadCourses();                                  // boot fails here, naming the file and the path, if a lesson is malformed
const BY_DIR = new Map();                                       // options.learn.contentDir -> courses, loaded once per directory
export const coursesOf = (k) => {
  const dir = k.config.contentDir;
  if (typeof dir !== 'string' || !dir) return COURSES;
  if (!BY_DIR.has(dir)) BY_DIR.set(dir, loadCourses(pathToFileURL(path.resolve(dir) + path.sep)));
  return BY_DIR.get(dir);
};
export const courseOf = (k, playerId) => coursesOf(k).get(k.players.classOf(playerId)?.course_id) ?? null;
export const progressRows = (k, playerId, worldId) => new Map(k.db.prepare('SELECT * FROM learn_progress WHERE player_id = ? AND world_id = ?').all(playerId, worldId).map((r) => [r.level_id, r]));

// The road: a unit opens when every earlier unit that has levels is done; a level opens when the one before it in the unit is done.
// Units with no levels yet are teasers ('soon') and never block anything.
// A class may have only some units open (learn_open_set / learn_open_unit, docs/learn.md "Open units"): `openSet` is null (no setting: every unit is open) or a Set of
// unit ids. A unit with levels that is not in it is 'closed' (its levels 'locked') and blocks nothing; the order rule counts only the open units.
function roadOf(idx, done, openSet = null) {
  let open = true;
  const status = new Map(), units = [];
  for (const { section, unit } of idx.units) {
    if (!unit.levels.length) { units.push({ section, unit, status: 'soon', done: 0 }); continue; }
    if (openSet && !openSet.has(unit.id)) {
      for (const l of unit.levels) status.set(l.id, 'locked');
      units.push({ section, unit, status: 'closed', done: unit.levels.filter((l) => done.has(l.id)).length });
      continue;
    }
    let prevDone = true, n = 0;
    for (const l of unit.levels) {
      const d = done.has(l.id);
      status.set(l.id, d ? 'done' : open && prevDone ? 'next' : 'locked');
      prevDone = d;
      if (d) n++;
    }
    const all = n === unit.levels.length;
    units.push({ section, unit, status: all ? 'done' : open ? 'current' : 'locked', done: n });
    open = open && all;
  }
  return { status, units, next: idx.levels.find((e) => status.get(e.level.id) === 'next') ?? null };
}

// The set of unit ids open to this student's class, or null (no setting = everything open).
const openSetOf = (k, playerId) => {
  const c = k.players.classOf(playerId);
  return c && k.db.prepare('SELECT 1 FROM learn_open_set WHERE class_id = ?').get(c.id) ? new Set(k.db.prepare('SELECT unit_id FROM learn_open_unit WHERE class_id = ?').all(c.id).map((r) => r.unit_id)) : null;
};
export const roadFor = (k, playerId, idx, done) => roadOf(idx, done, openSetOf(k, playerId));
// /start, /answer and /finish on a level of a closed unit: 403, before anything is read or written.
export function assertOpen(k, user, e) {
  const set = openSetOf(k, user.id);
  if (set && !set.has(e.unit.id)) throw new k.HttpError(403, 'That unit is not open for your class yet.');
}
export const nextInfo = (e) => e && { level_id: e.level.id, title: e.level.title, unit_id: e.unit.id, unit_title: e.unit.title, section_title: e.section.title, n: e.n, of: e.of };

// ---- one attempt = one row; its state says what was answered first and what is still to fix ----
export const loadAttempt = (k, playerId, worldId, levelId) => {
  const row = k.db.prepare('SELECT * FROM learn_attempts WHERE player_id = ? AND world_id = ? AND level_id = ? AND finished_at IS NULL').get(playerId, worldId, levelId);
  return row && { ...row, st: JSON.parse(row.state) };
};
export const saveAttempt = (k, a) => k.db.prepare('UPDATE learn_attempts SET state = ? WHERE id = ?').run(JSON.stringify(a.st), a.id);

export function entryFor(k, user, levelId) {
  const idx = courseOf(k, user.id);
  const e = idx?.byLevel.get(levelId);
  if (!e) throw new k.HttpError(404, 'That level does not exist');
  return { idx, e };
}
