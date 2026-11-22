// Teachers, classes, pseudonymous students and sessions. No names, emails or birthdates are ever stored:
// a student is a teacher-issued username (AdjectiveAnimal42) plus a 6-digit PIN, hashed with scrypt.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { withTxn, logAudit } from './db.js';
import { HttpError } from './errors.js';

const scrypt = promisify(crypto.scrypt);
const COST = { N: 16384, r: 8, p: 1 };
const NO_SALT = Buffer.alloc(16);
const MIN_PASSPHRASE = 12;
const INVITE_DAYS = 7;

export async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(secret, salt, 32, COST)).toString('hex')}`;
}

export async function verifySecret(secret, stored) {
  const [alg, salt = '', hash = ''] = String(stored).split('$');
  const key = await scrypt(secret, salt ? Buffer.from(salt, 'hex') : NO_SALT, 32, COST); // always do the work
  const want = Buffer.from(hash, 'hex');
  return alg === 'scrypt' && want.length === key.length && crypto.timingSafeEqual(key, want);
}

// Like Promise.all(items.map(fn)) but with at most `limit` calls in flight, results in order. scrypt costs 16 MB each, so hashing 60 PINs
// at once would peak near 1 GB on the VM.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
const HASH_CONCURRENCY = 8;

const ADJECTIVES = ['Brave', 'Bright', 'Calm', 'Clever', 'Cosmic', 'Eager', 'Fancy', 'Gentle', 'Golden', 'Happy', 'Jolly', 'Keen', 'Lucky', 'Merry', 'Mighty', 'Nimble',
  'Plucky', 'Proud', 'Quick', 'Quiet', 'Rapid', 'Shiny', 'Silver', 'Snappy', 'Sunny', 'Swift', 'Steady', 'Witty', 'Wise', 'Zesty', 'Bold', 'Cheery'];
const ANIMALS = ['Badger', 'Beaver', 'Bison', 'Cougar', 'Dolphin', 'Eagle', 'Falcon', 'Ferret', 'Fox', 'Gecko', 'Heron', 'Husky', 'Lynx', 'Moose', 'Newt', 'Otter',
  'Owl', 'Panda', 'Puffin', 'Quokka', 'Raven', 'Robin', 'Seal', 'Sparrow', 'Stoat', 'Tiger', 'Turtle', 'Walrus', 'Wolf', 'Wombat', 'Yak', 'Zebra'];
const pick = (list) => list[crypto.randomInt(list.length)];
export const DEVICE_DAYS = 180;
// A session also ends after this long with no request (on top of its 14-day cap): a student's after a school day, a teacher's after a
// long one. last_seen is written at most once per TOUCH_MS, so a busy page does not turn every read into a write.
export const IDLE_MS = { student: 8 * 3600e3, teacher: 12 * 3600e3 };
const TOUCH_MS = 60e3;
const IDLE_SQL = `CASE WHEN p.role = 'teacher' THEN ${IDLE_MS.teacher} ELSE ${IDLE_MS.student} END`;
export const sha = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newPin = () => String(crypto.randomInt(1_000_000)).padStart(6, '0');
export const MAX_BATCH = 200;   // students removed or PINs reset in one request
function className(name) {
  name = typeof name === 'string' ? name.trim() : '';
  if (!name || name.length > 40) throw new HttpError(400, 'Block name is required (40 characters max)');
  return name;
}

// The console's two read models, each one grouped join (never a subquery per row): a teacher's classes with student counts, and a class's
// students with their summed balances. Exported so a test can EXPLAIN them. Both walk an index (class_teachers, players_class,
// accounts' UNIQUE (owner_type, owner_id, kind)) and never touch entries or txns.
export const SQL = {
  teacherClasses: `SELECT c.id, c.name, c.course_id, COUNT(p.id) AS students
    FROM class_teachers ct JOIN classes c ON c.id = ct.class_id LEFT JOIN players p ON p.class_id = c.id
    WHERE ct.teacher_id = ? AND c.archived IS NULL GROUP BY c.id ORDER BY c.id`,
  classStudents: `SELECT p.id, p.username, p.created, p.first_login IS NOT NULL AS active, COALESCE(SUM(a.balance_cents), 0) AS balance_cents
    FROM players p LEFT JOIN accounts a ON a.owner_type = 'player' AND a.owner_id = p.id
    WHERE p.class_id = ? AND p.role = 'student' GROUP BY p.id ORDER BY p.username`,
};

export function createPlayers(app) {
  const { db, config, clock } = app;
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  // authenticate() remembers which pin_hash it verified against (keyed by the object it returns). The hash itself never leaves
  // this file; a login or passphrase change is applied only if the stored hash is still that one.
  const verified = new WeakMap();
  const unchanged = (user) => one('SELECT pin_hash FROM players WHERE id = ?', user.id)?.pin_hash === verified.get(user);

  // ---- class management: students of a live class ----
  // ACTIVE = first_login is set: the student has started a session at least once (migration 014). Only student-initiated activity counts.
  // What the system does to every new account is not activity: onPlayer opens accounts, ticks bill and pay them, and bills' autopay posts
  // as 'player:<id>', so txns.actor and "has money or rows" both say nothing. Sessions alone are not enough either (resetPin and the idle
  // purge delete them), and seen_world_id misses a login in a closed world or one whose onLogin hook threw. Every student request needs a
  // session, so a student who never had one has done nothing.
  const STUDENTS_OF = "SELECT id, username, class_id, first_login FROM players p WHERE class_id = ? AND role = 'student' AND EXISTS (SELECT 1 FROM classes c WHERE c.id = p.class_id AND c.archived IS NULL)";
  function studentsIn(classId, ids) {
    const rows = db.prepare(`${STUDENTS_OF} AND id IN (SELECT value FROM json_each(?)) ORDER BY username`).all(classId, JSON.stringify(ids));
    if (rows.length !== new Set(ids).size) throw new HttpError(404, 'Not found');   // same as the policy: never say which id is someone else's
    return rows;
  }
  // Detach each student: no class (so no tick sees them, lib/modules.js), a PIN nothing matches ('!', as authenticate() uses for unknown
  // names), no sessions or trusted devices, and every non-zero account swept to the sink as core.student_removed (as core.season_reset does,
  // sign included), so the ledger stays balanced and the accounts never move again. Call inside a transaction.
  function detach(classId, rows, actor, tx) {
    const busy = rows.filter((p) => p.first_login !== null).map((p) => p.username);
    if (busy.length) {
      const names = busy.slice(0, 10).join(', ') + (busy.length > 10 ? ` and ${busy.length - 10} more` : '');
      throw new HttpError(409, `Active students can't be removed: ${names} ${busy.length === 1 ? 'has' : 'have'} already logged in`);
    }
    const sink = app.ledger.system('sink');
    for (const p of rows) {
      db.prepare("UPDATE players SET class_id = NULL, pin_hash = '!' WHERE id = ?").run(p.id);
      db.prepare('DELETE FROM sessions WHERE player_id = ?').run(p.id);
      db.prepare('DELETE FROM trusted_devices WHERE player_id = ?').run(p.id);
      for (const a of db.prepare("SELECT id, balance_cents FROM accounts WHERE owner_type = 'player' AND owner_id = ? AND balance_cents <> 0 ORDER BY id").all(p.id)) {
        app.ledger.post({ kind: 'core.student_removed', actor, meta: { classId }, legs: [{ account: a.id, cents: -a.balance_cents, memo: 'Student removed' }, { account: sink, cents: a.balance_cents, memo: 'Student removed' }] });
      }
      tx.onCommit(() => app.events.emit('session.revoked', { playerId: p.id }));
    }
    if (rows.length) logAudit(db, actor, 'students.remove', { classId, players: rows.map((p) => p.id) });
    return rows.length;
  }
  // New PINs for these rows ({ id, username, class_id }): hashed first (slow, async), then one transaction. A student removed or moved
  // meanwhile is a 404 for the whole batch, so a removed student's '!' is never overwritten with a working PIN.
  async function reissue(rows, actor) {
    const pins = rows.map(() => newPin());
    const hashes = await mapLimit(pins, HASH_CONCURRENCY, hashSecret);
    withTxn(db, (tx) => {
      const set = db.prepare("UPDATE players SET pin_hash = ? WHERE id = ? AND class_id = ? AND role = 'student'");
      rows.forEach((p, i) => {
        if (!set.run(hashes[i], p.id, p.class_id).changes) throw new HttpError(404, 'Student not found');
        db.prepare('DELETE FROM sessions WHERE player_id = ?').run(p.id); // forces a fresh login
        logAudit(db, actor, 'pin.reset', { player: p.id });
        tx.onCommit(() => app.events.emit('session.revoked', { playerId: p.id }));
      });
    });
    return rows.map((p, i) => ({ id: p.id, username: p.username, pin: pins[i] }));
  }

  function freshUsername() {
    for (;;) {
      const name = `${pick(ADJECTIVES)}${pick(ANIMALS)}${10 + crypto.randomInt(90)}`;
      if (!one('SELECT 1 FROM players WHERE username = ?', name)) return name;
    }
  }

  return {
    hashSecret, verifySecret,

    teacherClasses: (teacherId) => db.prepare(SQL.teacherClasses).all(teacherId),
    classStudents: (classId) => db.prepare(SQL.classStudents).all(classId),

    get: (id) => one('SELECT id, username, role, class_id FROM players WHERE id = ?', id),
    byUsername: (username) => one('SELECT id, username, role, class_id FROM players WHERE username = ?', username),

    // The teacher's only defence is the passphrase (teacher accounts are never locked out), so it must be long.
    checkPassphrase(passphrase) {
      if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) throw new HttpError(400, `Passphrase must be at least ${MIN_PASSPHRASE} characters`);
      if (passphrase.length > 200) throw new HttpError(400, 'Passphrase is too long');
    },

    // verifiedUser (optional): the authenticate() result that authorised this change; refused with 401 if the passphrase changed since.
    async setPassphrase(playerId, passphrase, actor = 'system', verifiedUser = null) {
      this.checkPassphrase(passphrase);
      const hash = await hashSecret(passphrase);
      withTxn(db, (tx) => {
        if (verifiedUser && !unchanged(verifiedUser)) throw new HttpError(401, 'Your passphrase changed meanwhile. Log in again.');
        db.prepare("UPDATE players SET pin_hash = ? WHERE id = ? AND role = 'teacher'").run(hash, playerId);
        db.prepare('DELETE FROM sessions WHERE player_id = ?').run(playerId);
        db.prepare('DELETE FROM trusted_devices WHERE player_id = ?').run(playerId);   // a new passphrase forgets the old trusted browsers
        logAudit(db, actor, 'passphrase.change', { player: playerId });
        tx.onCommit(() => app.events.emit('session.revoked', { playerId }));
      });
    },

    async createTeacher({ username, passphrase, actor = 'system' }) {
      if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, 'Username: 3 to 32 letters, numbers, _ . -');
      this.checkPassphrase(passphrase);
      if (one("SELECT 1 FROM players WHERE role = 'teacher'")) throw new HttpError(409, 'Already set up');   // cheap early exit: no hashing for strangers
      const hash = await hashSecret(passphrase);
      return withTxn(db, () => {
        if (one("SELECT 1 FROM players WHERE role = 'teacher'")) throw new HttpError(409, 'Already set up');
        const id = Number(db.prepare("INSERT INTO players (username, pin_hash, role, world_teacher, created) VALUES (?, ?, 'teacher', 1, ?)").run(username, hash, clock.now()).lastInsertRowid);
        if (!app.world.current()) app.world.create();
        logAudit(db, actor, 'setup', { teacher: id });
        return id;
      });
    },

    // A second teacher joins by invite (docs/teachers-seasons.md): token from createInvite(), single use, 7 days. Not the world teacher.
    // Unknown, used and expired tokens look the same (404). The checks run before the slow hash, and again inside the transaction.
    async joinTeacher({ token, username, passphrase }) {
      const live = () => one('SELECT token_hash FROM teacher_invites WHERE token_hash = ? AND used_by IS NULL AND expires > ?', sha(token), clock.now());
      const gone = () => new HttpError(404, 'This invite link is not valid or has expired');
      if (typeof token !== 'string' || !live()) throw gone();
      if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, 'Username: 3 to 32 letters, numbers, _ . -');
      this.checkPassphrase(passphrase);
      const hash = await hashSecret(passphrase);
      return withTxn(db, () => {
        if (!live()) throw gone();
        if (one('SELECT 1 FROM players WHERE username = ?', username)) throw new HttpError(409, 'That username is taken');
        const id = Number(db.prepare("INSERT INTO players (username, pin_hash, role, world_teacher, created) VALUES (?, ?, 'teacher', 0, ?)").run(username, hash, clock.now()).lastInsertRowid);
        db.prepare('UPDATE teacher_invites SET used_by = ? WHERE token_hash = ?').run(id, sha(token));
        logAudit(db, `player:${id}`, 'teacher.join', { teacher: id });
        return id;
      });
    },

    // Only the sha256 is stored; the token is returned once.
    createInvite(createdBy) {
      const token = crypto.randomBytes(32).toString('hex');
      withTxn(db, () => {
        db.prepare('INSERT INTO teacher_invites (token_hash, created_by, expires) VALUES (?, ?, ?)').run(sha(token), createdBy, clock.now() + INVITE_DAYS * 864e5);
        logAudit(db, `player:${createdBy}`, 'teacher.invite', {});
      });
      return token;
    },

    // teacherId: who owns the class (inserted in the same transaction); defaults to the player in actor ('player:<id>').
    createClass({ name, course, actor = 'system', teacherId = /^player:(\d+)$/.exec(actor)?.[1] }) {
      name = className(name);
      if (!Object.hasOwn(config.courses, course)) throw new HttpError(400, 'Unknown course');
      const world = app.world.current();
      if (!world) throw new HttpError(409, 'No world yet');
      return withTxn(db, (tx) => {
        const id = Number(db.prepare('INSERT INTO classes (world_id, name, course_id, created) VALUES (?, ?, ?, ?)').run(world.id, name, course, clock.now()).lastInsertRowid);
        if (teacherId !== undefined) db.prepare('INSERT INTO class_teachers (class_id, teacher_id) VALUES (?, ?)').run(id, Number(teacherId));
        logAudit(db, actor, 'class.create', { id, name, course });
        tx.onCommit(() => app.events.emit('class.created', { classId: id, course_id: course }));
        return { id, name, course_id: course };
      });
    },

    // Returns [{ id, username, pin }]. PINs exist in plain text only in this return value, to print the cards.
    // hash:false makes bots that can never log in (the simulator); their pin is null.
    async createStudents({ classId, count, hash = true, actor = 'system' }) {
      const live = () => one('SELECT * FROM classes WHERE id = ? AND archived IS NULL', classId);
      const cls = live();
      if (!cls) throw new HttpError(404, 'Class not found');
      if (!Number.isInteger(count) || count < 1 || count > 60) throw new HttpError(400, 'Create 1 to 60 students at a time');
      const pins = Array.from({ length: count }, () => (hash ? newPin() : null));
      const hashes = hash ? await mapLimit(pins, HASH_CONCURRENCY, hashSecret) : pins.map(() => '!');
      return withTxn(db, (tx) => {
        if (!live()) throw new HttpError(404, 'Class not found');   // deleted while the PINs were hashing
        const ins = db.prepare("INSERT INTO players (username, pin_hash, class_id, role, created) VALUES (?, ?, ?, 'student', ?)");
        const out = pins.map((pin, i) => {
          const username = freshUsername();
          const id = Number(ins.run(username, hashes[i], classId, clock.now()).lastInsertRowid);
          app.modules.onPlayer({ id, username, class_id: classId }, cls.course_id);
          return { id, username, pin };
        });
        logAudit(db, actor, 'students.create', { classId, count });
        tx.onCommit(() => app.events.emit('players.created', { classId, playerIds: out.map((s) => s.id) }));
        return out;
      });
    },

    // A removed student (class_id NULL) is not found: a new PIN would let them log in again.
    async resetPin(playerId, actor = 'system') {
      const p = one("SELECT id, username, class_id FROM players WHERE id = ? AND role = 'student' AND class_id IS NOT NULL", playerId);
      if (!p) throw new HttpError(404, 'Student not found');
      return (await reissue([p], actor))[0];
    },

    // New PINs for these students of the class (ids omitted: all of them), at most 200. Returns [{ id, username, pin }] for the cards.
    async resetPins({ classId, ids, actor = 'system' }) {
      const rows = ids === undefined ? db.prepare(`${STUDENTS_OF} ORDER BY username`).all(classId) : studentsIn(classId, ids);
      if (rows.length > MAX_BATCH) throw new HttpError(400, `Reset at most ${MAX_BATCH} PINs at a time`);
      return reissue(rows, actor);
    },

    renameClass({ classId, name, actor = 'system' }) {
      name = className(name);
      return withTxn(db, () => {
        if (!db.prepare('UPDATE classes SET name = ? WHERE id = ? AND archived IS NULL').run(name, classId).changes) throw new HttpError(404, 'Class not found');
        logAudit(db, actor, 'class.rename', { classId, name });
        return { id: classId, name };
      });
    },

    // Soft removal (rows are never deleted: foreign keys everywhere, an append-only ledger). All or nothing: 404 unless every id is a
    // student of this class, 409 if any has logged in. Returns { removed }.
    removeStudents({ classId, ids, actor = 'system' }) {
      return withTxn(db, (tx) => ({ removed: detach(classId, studentsIn(classId, ids), actor, tx) }));
    },

    // confirm must be the class name exactly. Removes every student (409 if any has logged in), then hides the class (classes.archived).
    deleteClass({ classId, confirm, actor = 'system' }) {
      return withTxn(db, (tx) => {
        const cls = one('SELECT id, name FROM classes WHERE id = ? AND archived IS NULL', classId);
        if (!cls) throw new HttpError(404, 'Class not found');
        if (confirm !== cls.name) throw new HttpError(400, 'Type the class name exactly as it is to delete it');
        detach(classId, db.prepare(STUDENTS_OF).all(classId), actor, tx);
        db.prepare('UPDATE classes SET archived = ? WHERE id = ?').run(clock.now(), classId);
        logAudit(db, actor, 'class.delete', { classId, name: cls.name });
        return { deleted: true };
      });
    },

    // Returns { id, username, role, class_id } or null; the hash never leaves this file. Always costs one scrypt, found or not.
    async authenticate(username, secret) {
      const p = one('SELECT * FROM players WHERE username = ?', username);
      const ok = await verifySecret(secret, p ? p.pin_hash : '!');
      if (!p || !ok) return null;
      const user = { id: p.id, username: p.username, role: p.role, class_id: p.class_id };
      verified.set(user, p.pin_hash);
      return user;
    },

    // Starts a session for an authenticate() result unless the secret was changed or reset while it was being checked; null if so.
    // Synchronous, so nothing can change the hash between the check and the insert.
    startSessionIfUnchanged(user, days) { return unchanged(user) ? this.startSession(user.id, days) : null; },

    startSession(playerId, days) {
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions (token_hash, player_id, expires, last_seen) VALUES (?, ?, ?, ?)').run(sha(token), playerId, clock.now() + days * 864e5, clock.now());
      db.prepare('UPDATE players SET first_login = ? WHERE id = ? AND first_login IS NULL').run(clock.now(), playerId);   // ACTIVE (migration 014)
      return token;
    },
    // Teacher trusted devices (migration 011): a long-lived random cookie, stored hashed. isTrustedDevice() is true only for that
    // player's own, unexpired token.
    createTrustedDevice(playerId) {
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO trusted_devices (token_hash, player_id, created, last_used) VALUES (?, ?, ?, ?)').run(sha(token), playerId, clock.now(), clock.now());
      return token;
    },
    isTrustedDevice: (token, playerId) => typeof token === 'string' && token !== ''
      && !!one('SELECT 1 FROM trusted_devices WHERE token_hash = ? AND player_id = ? AND last_used > ?', sha(token), playerId, clock.now() - DEVICE_DAYS * 864e5),
    touchTrustedDevice: (token) => { db.prepare('UPDATE trusted_devices SET last_used = ? WHERE token_hash = ?').run(clock.now(), sha(token)); },   // expiry counts from the last trusted login
    forgetTrustedDevice: (token) => typeof token === 'string' && db.prepare('DELETE FROM trusted_devices WHERE token_hash = ?').run(sha(token)).changes > 0,

    // The session's player, or undefined if it is unknown, past its cap or idle too long. Refreshes last_seen (at most once a minute).
    sessionUser(token) {
      const now = clock.now();
      const u = one(`SELECT p.id, p.username, p.role, p.world_teacher, p.class_id, p.seen_world_id, c.name AS class_name, c.course_id, s.last_seen
        FROM sessions s JOIN players p ON p.id = s.player_id LEFT JOIN classes c ON c.id = p.class_id
        WHERE s.token_hash = ? AND s.expires > ? AND s.last_seen > ? - ${IDLE_SQL}`, sha(token), now, now);
      if (u && now - u.last_seen >= TOUCH_MS) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, sha(token));
      return u;
    },
    endSession(token) {
      withTxn(db, (tx) => {
        const tokenHash = sha(token);
        const row = one('SELECT player_id FROM sessions WHERE token_hash = ?', tokenHash);
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
        if (row) tx.onCommit(() => app.events.emit('session.revoked', { playerId: row.player_id, tokenHash }));
      });
    },
    // Log out everywhere: every session of this player (their open streams close); trusted devices are kept.
    endAllSessions(playerId) {
      withTxn(db, (tx) => {
        db.prepare('DELETE FROM sessions WHERE player_id = ?').run(playerId);
        tx.onCommit(() => app.events.emit('session.revoked', { playerId }));
      });
    },
    purgeSessions() {
      withTxn(db, (tx) => {
        const now = clock.now();
        const dead = `SELECT s.token_hash, s.player_id FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.expires < ?1 OR s.last_seen <= ?1 - ${IDLE_SQL}`;
        const rows = db.prepare(dead).all(now);
        db.prepare(`DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM (${dead}))`).run(now);
        db.prepare('DELETE FROM trusted_devices WHERE last_used < ?').run(now - DEVICE_DAYS * 864e5);
        for (const r of rows) tx.onCommit(() => app.events.emit('session.revoked', { playerId: r.player_id, tokenHash: r.token_hash }));
      });
    },
  };
}
