# Teachers, classes and seasons (MIGRATION.md Step 7)

Built on the recommended answers to the two open decisions. Both are easy to flip later; each is isolated to one function.

- **D-a. Players keep their pseudonym across seasons.** Money resets to zero at season close; username, PIN, class and (future) achievements carry over. Flip: `world.close({ keepPlayers: false })` would also archive players; not built.
- **D-b. One "world teacher" advances the shared clock.** The setup teacher is the world teacher; other teachers manage only their own classes. Flip: change `can()` for `world.*`.

## Schema (`005_teachers_seasons.sql`)

```sql
ALTER TABLE players ADD COLUMN world_teacher INTEGER NOT NULL DEFAULT 0;
UPDATE players SET world_teacher = 1 WHERE role = 'teacher';     -- today there is exactly one

CREATE TABLE class_teachers (
  class_id   INTEGER NOT NULL REFERENCES classes(id),
  teacher_id INTEGER NOT NULL REFERENCES players(id),
  PRIMARY KEY (class_id, teacher_id)
);
INSERT INTO class_teachers SELECT c.id, p.id FROM classes c, players p WHERE p.role = 'teacher';

CREATE TABLE teacher_invites (
  token_hash TEXT PRIMARY KEY, created_by INTEGER NOT NULL REFERENCES players(id),
  expires INTEGER NOT NULL, used_by INTEGER REFERENCES players(id)
);

ALTER TABLE worlds ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed'));
CREATE TABLE season_results (
  world_id INTEGER NOT NULL REFERENCES worlds(id), player_id INTEGER NOT NULL REFERENCES players(id),
  net_worth_cents INTEGER NOT NULL, PRIMARY KEY (world_id, player_id)
);
```

## `lib/policy.js`

```js
createPolicy(db) → { can(user, action, resource = {}) → boolean, assert(user, action, resource) → throws HttpError(404) }
```

| Action | Allowed when |
|---|---|
| `class.read`, `class.manage` | `user.role === 'teacher'` and a `class_teachers` row for `(resource.classId, user.id)` exists |
| `player.manage` | teacher of the player's class |
| `world.advance`, `world.settings`, `world.close` | `user.world_teacher === 1` |
| `teacher.invite` | `user.world_teacher === 1` |
| `audit.read` | any teacher (whole-economy integrity is shared) |

`assert` throws **404** for class/player resources (do not reveal another teacher's classes exist) and 403 for world actions.

Wiring:
- `sessionUser()` also selects `world_teacher`.
- Every `/api/teach/*` route resolves its resource and calls `policy.assert`. `teach/state` returns only classes the teacher owns; `createClass` inserts the `class_teachers` row in the same txn.
- Module teacher routes: the facade gains `k.policy.assert(user, action, resource)`; bank-basic's `/settings` (per class), `/transfers` (filter to owned classes) and `/transfers/:id/reverse` (resolve the sender's class) use it. `teacherPanels` listed in `/api/me` are filtered to modules enabled for at least one course the teacher has a class in.

## Inviting a second teacher

- `POST /api/teach/invites` (world teacher) → `{ url }` with a 32-byte token, valid 7 days, single use; only the sha256 is stored.
- `/teach?invite=<token>` shows a setup form (username + 12+ char passphrase) → `POST /api/teach/join { token, username, passphrase }` creates a teacher (`world_teacher = 0`), marks the invite used, starts a session. Throttled like login.
- `createTeacher` (first-run setup) is unchanged.

## Season close

`world.close({ actor })`, world teacher only, in one `withTxn`:
1. Refuse unless `status = 'active'`.
2. For every student: `net_worth_cents = SUM(balance_cents)` over their accounts → `season_results`.
3. For every player and business account (every account but the two system ones) with a non-zero balance: `ledger.post({ kind: 'core.season_reset', legs: [{ account, cents: -balance }, { account: system('sink'), cents: +balance }] })` (negative balances on loan accounts are reset the same way, sign included). The ledger stays balanced and auditable.
(Each module's `seasonAssets` hook adds non-money assets, such as a home, to `season_results` between steps 2 and 3.)
4. `status = 'closed'`.
5. Each module's `seasonClose(k, { world })` hook, in load order, in the same transaction. It sees the final `season_results`, every player account at zero and `world.status = 'closed'`. A throw rolls the whole close back (nothing reset, the world stays active) and the request fails 500 naming the module. jobs resets `jobs_holdings` (not per world) to the entry wage here; leaderboards writes its finale (awards, Hall of Fame, Life Reviews) from the month-end snapshots.
6. Audit `world.close`; emit `world.closed { worldId }` after commit. It is a hint (student and teacher streams get `world { worldId }`) and a place for tidying that is per world anyway: housing marks the season's homes `ended`, exchange ends holdings and open orders. If one of those listeners fails, nothing is wrong: every housing and exchange query filters by the current `world_id`, so the closed world's rows are never read in the next one.

`world.create()` is refused while an active world exists. On create, all existing classes are moved to the new `world_id`, and `world.created { worldId }` is emitted after commit (relayed to every stream as `world { worldId }`). Module tables are untouched. Cleanup that must not be skipped belongs in `seasonClose`; per-world rows need none.

## Between seasons (closed world, before the next create)

`world.current()` is the closed world until the next create. While its status is not `active`:
- **Every student POST is refused** with 409 "The season is closed. Your teacher will start the next one soon." This is one check in the server's route dispatch (after the body is read, so the synchronous handler runs in the world it checked): every module route, and any core route that is not public. Core public routes (login, logout, setup, teacher join) still work. GETs work, so students can look at their final results. Teacher routes are unaffected.
- **Teacher actions that change per-player game state are refused** with 409 "The season is closed. Start the next one first." (`k.world.active()`): jobs `/assign`, `/decide`, `/promote`, `/raise`, which would otherwise write `jobs_holdings` after `seasonClose` reset it.
- **World-level teacher writes that only take effect at a later tick or in a live season are refused** with the same 409 (`k.world.active()`): a closed world never ticks again and the next world starts from defaults, so they would be accepted and silently lost. These are rates `POST /policy` and `/inflation`, insurance `/trigger`, exchange `/event` and `/freeze`, housing `/market` (the season's homes have ended), outfitters `/store`, savings `/rate`. Make them after creating the next season. Still allowed: per-class settings (bank settings, the job catalogue), and leaderboards `/hide` and `/freeze`, because the closed season's boards and Life Reviews are still what students see in the gap, so hiding amounts or (un)freezing acts on them now. Test: `test/seasons.test.js` "world-level teacher writes meant for the next tick are refused between seasons ..."
- **Past-season money cannot be moved back.** bank-basic's transfer reverse and exchange's trade undo refuse anything not from the current active world with 409 ("That transfer is from a past season." / "That trade is from a past season."): its season's accounts were reset, so a reversal would move this season's money. A transfer is from a past season when the world is closed or its `meta.worldId` is not the current world's id (transfers record `worldId`, as the welcome grant does; older ones without it fall back to `txns.created` before the current world's `created`).
- **`onLogin` hooks do not run** (`modules.onLogin` returns at once), so a first login in the gap pays no welcome grant; it is paid in the next world.
- The student app shows a "Season closed" screen instead of the town: the message, and (when leaderboards is enabled) the Life Review's final net worth and Wolf rank from `GET /api/leaderboards/board` (`last_season`).

## Crossing a season boundary while signed in

Sessions last 14 days, so a student can be signed in from one season into the next. `players.seen_world_id` (migration 010) is the last active world the student "logged in" to. `POST /api/login` runs the `onLogin` hooks (when the world is active) and sets it; `GET /api/me` does the same when it differs from the current active world. The hooks are idempotent per world (bank-basic checks `meta.worldId` on its grant; bills uses `INSERT OR IGNORE` per world), so a login after a `/api/me` pays nothing twice. `seen_world_id` is set only when every hook returned without throwing (`modules.onLogin` returns true), so a hook that failed is retried on the next `/api/me`. Connected students get `world` on close and on create, which makes `public/sync.js` re-sync; the student app redraws in full when the world's status changes.

## Changing a class after it is made (migration 014)

Teacher console, on each class card: Rename, Delete class, and in "Show students" a checkbox per student with Remove selected and Reissue PIN cards for selected. "Generate accounts and PIN cards" asks first when the class already has students (each press adds a new batch).

- Routes (all `class.manage`): `POST /api/teach/classes/:id/rename {name}`, `/remove-students {ids}`, `/delete {confirm: <class name>}`, `/reset-pins {ids?}` (no ids = whole class). Code in `lib/players.js`.
- **Active** = `players.first_login` is set (stamped by `startSession`). Migration 014 backfilled it from `seen_world_id` or a live session, so a student whose only logins are older and left neither reads as never logged in.
- **Remove** is refused (409) for any active student, and all-or-nothing. A removed student is detached, not deleted (foreign keys and the append-only ledger forbid a delete): `class_id` NULL, PIN set to an unmatchable value, sessions and trusted devices dropped, every non-zero account posted to the sink as `core.student_removed`, audit `students.remove`. Ticks, `k.players.student`, leaderboards and season close skip students with no class.
- **Delete** needs the exact class name and no active students. It removes every student as above and sets `classes.archived`; archived classes are hidden from teachers, modules and the tick.
- Removing an active student (one who left the course) is not built. Test: `test/class-manage.test.js`.

## Tests

1. Teacher B (via invite) cannot see or act on teacher A's class: state omits it; students list, unlock, reset PIN, bank settings, transfers feed and reverse all 404.
2. Teacher B cannot advance the world (403); A can.
3. Invite tokens: single use, expire, unknown → 404.
4. Close season: balances all zero, `audit()` ok, `season_results` matches pre-close balances, a second close → 409, create new world → classes move, students log in with the same PIN and receive the welcome grant again only if bank-basic's grant is per-world (make it per-world: the idempotency check includes `meta.worldId`).
5. `test/seasons.test.js`: in the gap, outfit resale, a first-login grant and a card application are refused while GETs, logout and teacher routes work; a session kept across close + create gets one grant on `/api/me` and `world` stream events; a normal close resets jobs and writes the leaderboards finale. `test/modules.test.js`: a throwing `seasonClose` fails the close (500 naming the module) and rolls back the reset and jobs' own `seasonClose`; the hook sees the world closed, results written and accounts zeroed.

## Teacher preview as a student

A teacher can see what a student of a course sees (Learning Road, town, Arcade) without any student existing in the real database. The teacher console has "View as FinTech 10 student" and "View as FinTech 20/30 student" buttons (the student page offers the same to a teacher). The teacher stays signed in as themselves; a second cookie, `pv`, holds the preview session.

- **Sandbox.** The preview runs on a separate app with its own database, `data/preview/vdaa.db` (`lib/preview.js`), made the first time a preview starts. It has its own world and season, its own `preview-teacher` (random passphrase, never shown), one class per course in `config/vdaa.json` and one preview student per course. It starts with a fresh world and default class settings, not the real classes' settings. Player ids there start at 1,000,000,000, so they can never equal a real id.
- **Nothing reaches real students.** Student routes (and `/api/me`, `/api/stream`) run on the sandbox while `pv` is set; teacher-only routes always run on the real app. The real database gets no player, session, ledger entry or reward from a preview, and the sandbox has its own live streams, so no event crosses. The sandbox never ticks: no auto-advance, no nightly audit. It never appears in a league, leaderboard, roster or class result.
- **Banner.** Every student view shows "Teacher preview" with "Start over" and "Exit preview". Opening the teacher console also ends a preview. A real student's `pv` cookie is ignored and cleared.
- **Routes** (teacher only): `GET /api/preview`, `POST /api/preview/start { course }`, `/exit`, `/reset { course }`.
- **Start over** makes a fresh preview student for that course (the old one stays unused in the sandbox). To wipe the whole sandbox, stop the server and delete `data/preview/`; it is rebuilt on the next preview. The nightly backup only copies `data/vdaa.db`, so the sandbox is not backed up, which is fine.
- Test: `test/preview-student.test.js`.
