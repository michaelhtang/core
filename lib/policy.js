// Who may do what (docs/teachers-seasons.md). One table of rules; routes and module routes call assert() with the resource they resolved.
import { HttpError } from './errors.js';

const CLASS_ACTIONS = new Set(['class.read', 'class.manage', 'player.manage']);

export function createPolicy(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const teaches = (user, classId) => user?.role === 'teacher' && Number.isSafeInteger(classId)
    && !!one('SELECT 1 FROM class_teachers ct JOIN classes c ON c.id = ct.class_id WHERE ct.class_id = ? AND ct.teacher_id = ? AND c.archived IS NULL', classId, user.id);   // a deleted class is no one's

  function can(user, action, resource = {}) {
    switch (action) {
      case 'class.read': case 'class.manage': return teaches(user, resource.classId);
      case 'player.manage': return Number.isSafeInteger(resource.playerId) && teaches(user, one("SELECT class_id FROM players WHERE id = ? AND role = 'student'", resource.playerId)?.class_id);
      case 'world.advance': case 'world.settings': case 'world.close': case 'teacher.invite': return user?.role === 'teacher' && user.world_teacher === 1;
      case 'audit.read': return user?.role === 'teacher';
      default: return false;
    }
  }

  return {
    can,
    // 404 for class and player resources (never reveal that another teacher's class exists), 403 for world actions.
    assert(user, action, resource = {}) {
      if (can(user, action, resource)) return;
      throw CLASS_ACTIONS.has(action) ? new HttpError(404, 'Not found') : new HttpError(403, 'Not allowed');
    },
  };
}
