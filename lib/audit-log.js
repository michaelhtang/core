// The audit_log reader (it was write-only). Newest first, PAGE rows per page, cursor = row id.
// The world teacher reads every row. Any other teacher reads only rows whose detail names a class they teach or a student in one:
//   class: `classId` or `class` (and `id` on class.create); student: `player` or `to`. A row that names neither (world ticks, setup,
//   invites, passphrase changes, old rows from before a key existed) cannot be scoped, so it is hidden from them.
// ponytail: the scoped query walks audit_log newest-first with json_extract and stops at PAGE + 1 hits; a teacher whose rows are rare
// reads further back. Add an audit_log_scope (log_id, class_id) table like bank_transfers if this ever shows in perf.
export const PAGE = 50;
const SECRET_KEY = /pin|hash|token|passphrase|secret|password/i;   // audit_log holds none of these; a reader must never start showing one

const COLUMNS = 'SELECT id, at, actor, action, detail FROM audit_log';
const SQL_ALL = `${COLUMNS} WHERE id < ? ORDER BY id DESC LIMIT ?`;
const SQL_MINE = `${COLUMNS} WHERE id < ? AND (
    COALESCE(CASE WHEN action = 'class.create' THEN json_extract(detail, '$.id') END, json_extract(detail, '$.classId'), json_extract(detail, '$.class'))
      IN (SELECT class_id FROM class_teachers WHERE teacher_id = ?)
    OR COALESCE(json_extract(detail, '$.player'), json_extract(detail, '$.to'))
      IN (SELECT p.id FROM players p JOIN class_teachers ct ON ct.class_id = p.class_id WHERE ct.teacher_id = ? AND p.role = 'student'))
  ORDER BY id DESC LIMIT ?`;

// before: only rows with a smaller id (omit for the newest page). Returns { log: [{ id, at, actor, actor_name, action, detail }], next? }.
export function readLog(db, user, { before = Number.MAX_SAFE_INTEGER } = {}) {
  const rows = user.world_teacher === 1
    ? db.prepare(SQL_ALL).all(before, PAGE + 1)
    : db.prepare(SQL_MINE).all(before, user.id, user.id, PAGE + 1);
  const more = rows.length > PAGE;
  if (more) rows.pop();
  const actors = rows.map((r) => /^player:(\d+)$/.exec(r.actor)?.[1]).filter(Boolean).map(Number);
  const names = new Map(db.prepare('SELECT id, username FROM players WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(actors)).map((p) => [p.id, p.username]));
  return {
    log: rows.map((r) => ({
      id: r.id, at: r.at, actor: r.actor, actor_name: names.get(Number(/^player:(\d+)$/.exec(r.actor)?.[1])) ?? null, action: r.action,
      detail: Object.fromEntries(Object.entries(JSON.parse(r.detail)).filter(([k]) => !SECRET_KEY.test(k))),
    })),
    ...(more && { next: rows.at(-1).id }),
  };
}
