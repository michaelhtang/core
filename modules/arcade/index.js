// arcade: pixel-art mini-games where the SERVER decides the score (docs/arcade.md). The browser plays a fixed-step, integer-only game
// (ui/games/<game>-core.js) and records its inputs as a change list; /finish replays those inputs through the very same file with the seed the
// server chose at /start. The API takes no score, so a client cannot claim one. Verified runs feed a class leaderboard and one Today errand.
// A session is one row of arcade_runs: open -> finished | rejected | expired | superseded (a new /start replaces an open one).
// The wall-time check is a bot-batch guard only; the score comes from the replay alone.
import { randomBytes } from 'node:crypto';
import { defineModule } from '../../lib/modules.js';
import { createThrottle } from '../../lib/throttle.js';
import * as billdash from './ui/games/billdash-core.js';
import * as diversify from './ui/games/diversify-core.js';
import * as debtsnake from './ui/games/debtsnake-core.js';
import { WORDS, WORDLE_TITLE, MAX_GUESSES, dayNumber, wordFor, mark } from './wordle-words.js';

// event: what a verified finish emits (module.arcade.<event>); one Today errand listens to each, so a round of one game never completes the other's errand.
const GAMES = {
  billdash: {
    title: 'Bill Dash',
    blurb: 'Catch paycheques, pay the bills before they go late, and skip the SALE tags. 45 seconds, 3 hearts.',
    core: billdash, event: 'played',
  },
  diversify: {
    title: 'Diversify',
    blurb: 'Drop each paycheque into a basket: cash, bonds, an index fund or a single stock. News hits the baskets over 45 seconds. Spread your money and keep your worst drop small.',
    core: diversify, event: 'played_diversify',
  },
  debtsnake: {
    title: 'Debt Snake',
    blurb: 'You are a long snake and your length is your loan. Eat payment coins to pay it down, watch the interest, and try 21 money-rule modes.',
    core: debtsnake, event: 'played_debtsnake',
  },
};
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12a4 4 0 0 1 4 4v3a3 3 0 0 1-5 2l-1-1H8l-1 1a3 3 0 0 1-5-2v-3a4 4 0 0 1 4-4zM8 10v4M6 12h4M16 11h.5M18 13h.5"/></svg>';
const EXPIRES_MS = 10 * 60e3, MIN_PLAY_PCT = 40, TOP = 10, SESSION = /^[0-9a-f]{32}$/;
const ok = Number.isSafeInteger;

const throttles = new WeakMap();
const throttleFor = (k) => {   // ponytail: in memory, per kernel; a restart forgets it (a start only costs a row)
  if (!throttles.has(k)) throttles.set(k, createThrottle({ now: k.clock.now, ip: k.config.startsPerHour ?? 12, ipWindowMs: 3600e3 }));
  return throttles.get(k);
};

// Each game has its own start limit (startsPerHour, default 12, in the last hour), so a student who used up Bill Dash can still play Diversify.
// The throttle key is per (student, game); the bucket key is never an address, so ipKey passes it through untouched.
function startAllowed(k, user, key, g) {
  try { throttleFor(k).reserve(`p${user.id}:${key}`, '', { teacher: true }); } catch (e) {
    if (e.status !== 429) throw e;
    const m = Math.max(1, Math.ceil(Number(/Wait (\d+)/.exec(e.message)?.[1] ?? 60) / 60));
    throw new k.HttpError(429, `That is ${k.config.startsPerHour ?? 12} rounds of ${g.title} this hour. Play another game, or come back in ${m} minute${m === 1 ? '' : 's'}.`);
  }
}

const gameOf = (k, key) => {
  if (typeof key !== 'string' || !Object.hasOwn(GAMES, key)) throw new k.HttpError(400, 'Unknown game');
  return GAMES[key];
};

// [[tick, mask], ...]: integers, strictly increasing ticks inside the round, masks 0 to the game's MASK_MAX (7 unless its core says otherwise), at most MAX_INPUTS entries.
function parseInputs(k, core, v) {
  const { ROUND, MAX_INPUTS } = core.C, maskMax = core.C.MASK_MAX ?? 7;
  if (!Array.isArray(v) || v.length > MAX_INPUTS) throw new k.HttpError(400, `inputs must be a list of at most ${MAX_INPUTS} [tick, mask] pairs`);
  let last = -1;
  for (const e of v) {
    if (!Array.isArray(e) || e.length !== 2 || !ok(e[0]) || !ok(e[1])) throw new k.HttpError(400, 'each input must be [tick, mask] with whole numbers');
    if (e[0] <= last || e[0] >= ROUND) throw new k.HttpError(400, `input ticks must increase and stay below ${ROUND}`);
    if (e[1] < 0 || e[1] > maskMax) throw new k.HttpError(400, `input masks must be 0 to ${maskMax}`);
    last = e[0];
  }
  return v;
}

// Per-class switches (the teacher's Arcade panel): a row in arcade_class_off turns one game off for one class; no row means on. `game` is a key of
// GAMES or the id of one of Mr. Tang's linked games (modules/games, service arcadeLinks). A game that is off is not shown to that class, cannot be
// started, and its Today errand is not offered there (todayFacts below).
const offFor = (k, classId) => (ok(classId) ? k.db.prepare('SELECT game FROM arcade_class_off WHERE class_id = ? ORDER BY game').all(classId).map((r) => r.game) : []);
const isOff = (k, classId, game) => ok(classId) && !!k.db.prepare('SELECT 1 FROM arcade_class_off WHERE class_id = ? AND game = ?').get(classId, game);
// The linked games a class of `course` sees (title only), when the games module is loaded.
const linksFor = (k, course) => (k.modules.has('games') ? k.modules.call('games', 'arcadeLinks', { course }) ?? [] : []);

// A game whose core has options (Debt Snake) keeps a best, a play count and a board for each mode key (arcade_runs.mode); `mode` null means every round of the game (Bill Dash and Diversify have no modes).
const hasModes = (g) => typeof g.core.parseOptions === 'function';
const bestOf = (k, playerId, worldId, game, mode = null) => k.db.prepare("SELECT MAX(score) AS best, COUNT(*) AS plays FROM arcade_runs WHERE player_id = ? AND world_id = ? AND game = ? AND (? IS NULL OR mode = ?) AND status = 'finished'").get(playerId, worldId, game, mode, mode);
// Every mode this student has finished: { classic: { best, plays }, ... }
const modesOf = (k, playerId, worldId, game) => Object.fromEntries(k.db.prepare("SELECT mode, MAX(score) AS best, COUNT(*) AS plays FROM arcade_runs WHERE player_id = ? AND world_id = ? AND game = ? AND status = 'finished' AND mode IS NOT NULL GROUP BY mode").all(playerId, worldId, game).map((r) => [r.mode, { best: r.best, plays: r.plays }]));
// A mode key from a URL: it must be a key the core's own parseOptions accepts and normalizes to itself ('classic', 'etransfer+latefees').
function modeKey(k, g, raw) {
  if (raw === null || raw === undefined || raw === '') return g.core.optionKey(g.core.parseOptions({}));
  try { const key = g.core.optionKey(g.core.parseOptions({ modes: String(raw).split('+') })); if (key === raw) return key; } catch { /* falls through to the 400 */ }
  throw new k.HttpError(400, 'Unknown mode');
}

// The player's class, best verified score each, top 10 (ties: who got there first).
function leaderboard(k, user, worldId, game, mode = null) {
  if (!ok(user.class_id)) return [];
  const names = new Map(k.players.inClass(user.class_id).map((p) => [p.id, p.username]));
  return k.db.prepare(`SELECT player_id, MAX(score) AS best, MIN(finished_at) AS at FROM arcade_runs
    WHERE world_id = ? AND game = ? AND (? IS NULL OR mode = ?) AND status = 'finished' AND player_id IN (SELECT value FROM json_each(?))
    GROUP BY player_id ORDER BY best DESC, at ASC LIMIT ?`).all(worldId, game, mode, mode, JSON.stringify([...names.keys()]), TOP)
    .map((r, i) => ({ rank: i + 1, username: names.get(r.player_id), best: r.best, mine: r.player_id === user.id }));
}

// ---- FinWord: one daily word per course (docs/arcade.md). No money, no XP, no event: just a row per student per day. ----
// The answer leaves the server only when the game is over (status won or lost); until then every response and error is built without it.
const WORDLE_KEY = 'wordle';
const courseOf = (k, user) => (ok(user.class_id) ? k.db.prepare('SELECT course_id FROM classes WHERE id = ?').get(user.class_id)?.course_id : undefined);   // a module's user has no course_id
const wordleEntry =(course, word) => WORDS[course]?.find((e) => e.word === word) ?? { word, term: word, meaning: '', section: '' };   // a word later removed from the list still ends its game
const wordleRow = (k, playerId, day) => k.db.prepare('SELECT * FROM arcade_wordle WHERE player_id = ? AND day = ?').get(playerId, day);

function wordleStats(k, playerId, today) {
  const rows = k.db.prepare("SELECT day, status, guesses FROM arcade_wordle WHERE player_id = ? AND status != 'open' ORDER BY day").all(playerId);
  const dist = [0, 0, 0, 0, 0, 0], won = new Set();
  let best = 0, run = 0, prev = null;
  for (const r of rows) {
    if (r.status !== 'won') { run = 0; prev = null; continue; }
    dist[JSON.parse(r.guesses).length - 1]++;
    const n = dayNumber(r.day);
    run = prev !== null && n === prev + 1 ? run + 1 : 1; prev = n; best = Math.max(best, run); won.add(n);
  }
  let current = 0;                                                       // consecutive days won, counted back from today; from yesterday only while today has no finished game (a loss today ends the streak)
  const todayDone = rows.some((r) => r.day === today);
  for (let n = dayNumber(today) - (todayDone ? 0 : 1); won.has(n); n--) current++;
  return { played: rows.length, won: won.size, current_streak: current, best_streak: best, distribution: dist };
}

function wordleView(k, user) {
  const day = k.clock.today(), course = courseOf(k, user);
  const today = wordFor(course, day);
  if (!today) throw new k.HttpError(400, `${WORDLE_TITLE} is not set up for your class.`);
  const row = wordleRow(k, user.id, day);
  const e = row ? wordleEntry(course, row.word) : today;
  const status = row?.status ?? 'open', guesses = row ? JSON.parse(row.guesses) : [];
  return {
    title: WORDLE_TITLE, day, length: e.word.length, section: e.section, max: MAX_GUESSES,
    guesses: guesses.map((g) => ({ guess: g, marks: mark(e.word, g) })), status, stats: wordleStats(k, user.id, day),
    ...(status === 'open' ? {} : { answer: e.word, term: e.term, meaning: e.meaning }),
  };
}

function wordleGuess(k, user, body) {
  if (isOff(k, user.class_id, WORDLE_KEY)) throw new k.HttpError(403, `Your teacher has turned ${WORDLE_TITLE} off for your class.`);
  const raw = k.input.str(body, 'guess', { max: 20 }), day = k.clock.today(), course = courseOf(k, user);
  const today = wordFor(course, day);
  if (!today) throw new k.HttpError(400, `${WORDLE_TITLE} is not set up for your class.`);
  const ended = k.db.txn(() => {
    const row = wordleRow(k, user.id, day);
    if (row && row.status !== 'open') throw new k.HttpError(409, 'Today\'s word is finished. Come back tomorrow.');
    const word = row?.word ?? today.word, guess = raw.toUpperCase();
    // ponytail: any A-Z string of the right length counts (no dictionary); add a word list if students spam nonsense
    if (!/^[A-Z]+$/.test(guess) || guess.length !== word.length) throw new k.HttpError(400, `A guess is ${word.length} letters, A to Z only.`);   // does not use a guess
    const guesses = [...(row ? JSON.parse(row.guesses) : []), guess];
    const status = guess === word ? 'won' : guesses.length >= MAX_GUESSES ? 'lost' : 'open';
    if (!row) k.db.prepare('INSERT INTO arcade_wordle (player_id, day, course, word) VALUES (?, ?, ?, ?)').run(user.id, day, course, word);
    k.db.prepare('UPDATE arcade_wordle SET guesses = ?, status = ?, finished_at = ? WHERE player_id = ? AND day = ?').run(JSON.stringify(guesses), status, status === 'open' ? null : k.clock.now(), user.id, day);
    return status !== 'open';
  });
  // Today's errand rewards playing a game to its end, not winning it: one event with the same payload for won and lost. No season, no event (the game still works).
  const w = k.world.current();
  if (ended && w?.status === 'active') k.events.emit('played_finword', { playerId: user.id, worldId: w.id, game: WORDLE_KEY });
  return wordleView(k, user);
}

export default defineModule({
  id: 'arcade',
  requires: ['bank-basic'],
  options: { startsPerHour: 'rounds one student may start per hour (default 12)' },

  migrations: [{ id: '001_runs', sql: `
CREATE TABLE arcade_runs (        -- one row per started round; score is the server's replay result, set at finish
  id TEXT PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), world_id INTEGER NOT NULL REFERENCES worlds(id),
  game TEXT NOT NULL, seed INTEGER NOT NULL, score INTEGER, ticks INTEGER,   -- ticks = how many the replay played (a round ends early at zero hearts)
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','finished','rejected','expired','superseded')),
  flag TEXT,                      -- why a finish was rejected ('fast')
  started_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX arcade_runs_board ON arcade_runs(world_id, game, status, player_id);
CREATE INDEX arcade_runs_player ON arcade_runs(player_id, world_id, status)` },
  { id: '002_class_off', sql: `
CREATE TABLE arcade_class_off (   -- a game the teacher turned off for one class (no row = on)
  class_id INTEGER NOT NULL REFERENCES classes(id),
  game     TEXT NOT NULL,         -- a GAMES key ('billdash', 'diversify') or a linked game id from modules/games ('stax', ...)
  PRIMARY KEY (class_id, game)
)` },
  { id: '003_wordle', sql: `
CREATE TABLE arcade_wordle (      -- FinWord: one row per student per day, made at the first guess; it keeps the word so a later list edit never changes a game in progress
  player_id INTEGER NOT NULL REFERENCES players(id), day TEXT NOT NULL, course TEXT NOT NULL, word TEXT NOT NULL,
  guesses TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  finished_at INTEGER,
  PRIMARY KEY (player_id, day)
)` },
  { id: '004_run_opts', sql: `
ALTER TABLE arcade_runs ADD COLUMN opts TEXT;   -- a core with options (Debt Snake): the normalized options JSON the round was started with; the replay uses it
ALTER TABLE arcade_runs ADD COLUMN mode TEXT;   -- that core's optionKey(opts): bests and boards are per mode (null for Bill Dash and Diversify)
CREATE INDEX arcade_runs_mode ON arcade_runs(world_id, game, mode, status, player_id)` }],

  services: {
    // Today: the Bill Dash, Diversify and Debt Snake errands are offered only while that game is on for the student's class.
    todayFacts(k, { playerId }) {
      const off = offFor(k, k.players.get(playerId)?.class_id);
      return { billdashOn: !off.includes('billdash'), diversifyOn: !off.includes('diversify'), debtsnakeOn: !off.includes('debtsnake'), finwordOn: !off.includes(WORDLE_KEY) };
    },
    // modules/games: the linked games this class's teacher turned off.
    offFor: (k, { classId }) => offFor(k, classId),
  },

  teacherPanels: [{ id: 'arcade-teach', title: 'Arcade', src: 'teach.js' }],

  panels: [{ id: 'arcade', building: { key: 'arcade', name: 'Arcade', icon: ICON }, src: 'arcade.js' }],

  routes: [
    {
      method: 'GET', path: '/state', access: 'student',   // cheap and read-only; ?game=debtsnake&mode=latefees returns that game's best, plays and board for that mode
      handler(k, { user, url }) {
        const w = k.world.current();
        const active = w?.status === 'active';
        const off = offFor(k, user.class_id);
        return {
          world_active: active,
          games: Object.entries(GAMES).filter(([key]) => !off.includes(key)).map(([key, g]) => {
            // a game with modes: best, plays and the board are for the mode asked for (?mode=, default classic); `modes` lists the student's best in every mode they have finished
            const mode = hasModes(g) ? modeKey(k, g, key === url?.searchParams.get('game') ? url.searchParams.get('mode') : null) : null;
            const mine = active ? bestOf(k, user.id, w.id, key, mode) : { best: null, plays: 0 };
            return { key, title: g.title, blurb: g.blurb, best: mine.best, plays: mine.plays, ticks: g.core.C.ROUND, leaderboard: active ? leaderboard(k, user, w.id, key, mode) : [],
              ...(mode ? { mode, modes: active ? modesOf(k, user.id, w.id, key) : {} } : {}) };
          }).concat(WORDS[courseOf(k, user)] && !off.includes(WORDLE_KEY) ? [{   // the daily word game: no score, no board, no season needed; the tile shows today's state
            key: WORDLE_KEY, kind: 'daily', title: WORDLE_TITLE, best: null, plays: 0, leaderboard: [], today: wordleRow(k, user.id, k.clock.today())?.status ?? 'new',
            blurb: 'One word a day from your course. Six guesses. Everyone in your course gets the same word.',
          }] : []),
          leaderboard: active ? leaderboard(k, user, w.id, 'billdash') : [],   // Bill Dash's board and best again, where they were before there was a second game
          my_best: active ? bestOf(k, user.id, w.id, 'billdash').best : null,
        };
      },
    },
    {
      method: 'GET', path: '/wordle', access: 'student',   // today's board for the student's course; the answer only once it is over
      handler(k, { user }) {
        if (isOff(k, user.class_id, WORDLE_KEY)) throw new k.HttpError(403, `Your teacher has turned ${WORDLE_TITLE} off for your class.`);
        return wordleView(k, user);
      },
    },
    {
      // One mode's best and class board for a game with modes (read only, no writes, nothing started).
      method: 'GET', path: '/board', access: 'student',
      handler(k, { user, url }) {
        const key = url?.searchParams.get('game') ?? '';
        const g = gameOf(k, key);
        if (!hasModes(g)) throw new k.HttpError(400, `${g.title} has no modes`);
        if (isOff(k, user.class_id, key)) throw new k.HttpError(403, `Your teacher has turned ${g.title} off for your class.`);
        const mode = modeKey(k, g, url?.searchParams.get('mode'));
        const w = k.world.current();
        const active = w?.status === 'active', mine = active ? bestOf(k, user.id, w.id, key, mode) : { best: null, plays: 0 };
        return { game: key, mode, best: mine.best, plays: mine.plays, leaderboard: active ? leaderboard(k, user, w.id, key, mode) : [] };
      },
    },
    { method: 'POST', path: '/wordle/guess', access: 'student', handler: (k, { user, body }) => wordleGuess(k, user, body) },
    {
      method: 'POST', path: '/start', access: 'student',
      handler(k, { user, body }) {
        const key = k.input.str(body, 'game', { max: 20 });
        const g = gameOf(k, key);
        if (isOff(k, user.class_id, key)) throw new k.HttpError(403, `Your teacher has turned ${g.title} off for your class.`);
        // A core with options (Debt Snake) takes an optional `opts` and says what is wrong with it; the normalized options are stored and the replay uses them.
        let opts = null, mode = null;
        if (hasModes(g)) {
          try { opts = g.core.parseOptions(body.opts ?? {}); mode = g.core.optionKey(opts); } catch (e) { throw new k.HttpError(400, e.message); }
        }
        const w = k.world.active();                                           // 409 between seasons
        startAllowed(k, user, key, g);                                         // 429 over startsPerHour for THIS game
        const id = randomBytes(16).toString('hex'), seed = randomBytes(4).readUInt32BE();
        k.db.txn(() => {
          k.db.prepare("UPDATE arcade_runs SET status = 'superseded' WHERE player_id = ? AND status = 'open'").run(user.id);
          k.db.prepare('INSERT INTO arcade_runs (id, player_id, world_id, game, seed, started_at, opts, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, user.id, w.id, key, seed, k.clock.now(), opts && JSON.stringify(opts), mode);
        });
        return { session: id, game: key, seed, ticks: g.core.C.ROUND, ...(opts ? { opts, mode } : {}) };
      },
    },
    {
      method: 'POST', path: '/finish', access: 'student',
      handler(k, { user, body }) {
        const sid = k.input.str(body, 'session', { max: 40 });
        if (!SESSION.test(sid)) throw new k.HttpError(400, 'session must be the id from /start');
        const run = k.db.prepare('SELECT * FROM arcade_runs WHERE id = ?').get(sid);
        if (!run || run.player_id !== user.id) throw new k.HttpError(404, 'Round not found');
        if (body.game !== undefined && body.game !== run.game) throw new k.HttpError(400, 'That round is a different game');
        const w = k.world.active();
        if (run.status !== 'open') throw new k.HttpError(409, run.status === 'finished' ? 'That round was already finished.' : 'That round is over. Start a new one.');
        const now = k.clock.now();
        if (run.world_id !== w.id || now - run.started_at > EXPIRES_MS) {
          k.db.prepare("UPDATE arcade_runs SET status = 'expired' WHERE id = ? AND status = 'open'").run(sid);
          throw new k.HttpError(409, 'That round ran out of time. Start a new one.');
        }
        const core = gameOf(k, run.game).core;
        const inputs = parseInputs(k, core, body.inputs);
        const end = core.replay(run.seed, inputs, run.opts ? JSON.parse(run.opts) : undefined);                            // outside any transaction; the score is this and nothing the client said
        const final = core.score(end), before = bestOf(k, user.id, w.id, run.game, run.mode).best;
        const minMs = Math.floor((end.tick * 1000 * MIN_PLAY_PCT) / (core.C.TPS * 100));
        const fast = now - run.started_at < minMs;
        const changed = k.db.txn(() => k.db.prepare("UPDATE arcade_runs SET status = ?, flag = ?, score = ?, ticks = ?, finished_at = ? WHERE id = ? AND status = 'open'")
          .run(fast ? 'rejected' : 'finished', fast ? 'fast' : null, fast ? null : final, end.tick, now, sid).changes);
        if (!changed) throw new k.HttpError(409, 'That round was already finished.');
        if (fast) throw new k.HttpError(422, 'That round finished faster than it can be played, so it does not count.');
        if (inputs.length) k.events.emit(GAMES[run.game].event, { playerId: user.id, worldId: w.id, game: run.game, score: final });   // an empty log is not a played round: it scores, but earns no errand
        const mine = bestOf(k, user.id, w.id, run.game, run.mode);
        return {
          score: final, best: mine.best, plays: mine.plays, new_best: before === null || final > before, ticks: end.tick, ...(run.mode ? { mode: run.mode } : {}),
          ...(core.report ? { stats: core.report(end) } : { hearts: end.lives, stats: end.stats }),   // each game's own debrief numbers
          leaderboard: leaderboard(k, user, w.id, run.game, run.mode),
        };
      },
    },
    {
      // A teacher: this season's rounds in each class they read, overall and per game. Read only; pseudonyms are what the teacher already sees everywhere.
      method: 'GET', path: '/teach', access: 'teacher',
      handler(k, { user }) {
        const w = k.world.current();
        const total = k.db.prepare(`SELECT COUNT(CASE WHEN status = 'finished' THEN 1 END) AS finished, COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected,
          COUNT(DISTINCT CASE WHEN status = 'finished' THEN player_id END) AS players FROM arcade_runs WHERE world_id = ? AND (? IS NULL OR game = ?) AND player_id IN (SELECT value FROM json_each(?))`);
        const why = k.db.prepare("SELECT flag, COUNT(*) AS n FROM arcade_runs WHERE world_id = ? AND (? IS NULL OR game = ?) AND status = 'rejected' AND player_id IN (SELECT value FROM json_each(?)) GROUP BY flag");
        const run = (order, limit) => k.db.prepare(`SELECT player_id, game, score, finished_at FROM arcade_runs WHERE world_id = ? AND (? IS NULL OR game = ?) AND status = 'finished' AND player_id IN (SELECT value FROM json_each(?))
          ORDER BY ${order} LIMIT ${limit}`);
        const best = run('score DESC, finished_at ASC', 1), recent = run('finished_at DESC, rowid DESC', 10);
        // one slice: every game together (game = null) or one game
        const slice = (wid, ids, name, game) => {
          const t = total.get(wid, game, game, ids), b = best.get(wid, game, game, ids);
          return {
            finished: t.finished, rejected: t.rejected, rejected_by: Object.fromEntries(why.all(wid, game, game, ids).map((x) => [x.flag ?? 'other', x.n])), players: t.players,
            best: b ? { score: b.score, username: name.get(b.player_id), game: b.game } : null,
            recent: recent.all(wid, game, game, ids).map((r) => ({ username: name.get(r.player_id), game: r.game, score: r.score, at: r.finished_at })),
          };
        };
        const empty = { finished: 0, rejected: 0, rejected_by: {}, players: 0, best: null, recent: [] };
        return {
          season: w?.status === 'active' ? w.name : null,
          classes: k.players.classesFor(user).map((c) => {
            const name = new Map(k.players.inClass(c.id).map((p) => [p.id, p.username]));
            const ids = JSON.stringify([...name.keys()]);
            const off = offFor(k, c.id);
            return {
              id: c.id, name: c.name, ...(w ? slice(w.id, ids, name, null) : empty),
              // every switch for this class: the Arcade's own games, then the linked ones its course sees
              switches: [...Object.entries(GAMES).map(([key, g]) => ({ key, title: g.title, linked: false })), { key: WORDLE_KEY, title: WORDLE_TITLE, linked: false }, ...linksFor(k, c.course_id).map((l) => ({ key: l.id, title: l.title, linked: true }))]
                .map((x) => ({ ...x, on: !off.includes(x.key) })),
              games: Object.entries(GAMES).map(([key, g]) => ({ key, title: g.title, ...(w ? slice(w.id, ids, name, key) : empty) })),
            };
          }),
        };
      },
    },
    {
      // A teacher turns one game on or off for one of their classes. Off: hidden from that class, cannot be started, its errand not offered.
      method: 'POST', path: '/switch', access: 'teacher',
      handler(k, { user, body }) {
        const classId = k.input.int(body, 'class_id', { min: 1 });
        const game = k.input.str(body, 'game', { max: 20 });
        const on = k.input.bool(body, 'enabled');
        k.policy.assert(user, 'class.manage', { classId });                  // 404 for a class that is not yours
        const course = k.players.classes().find((c) => c.id === classId)?.course_id;
        if (!Object.hasOwn(GAMES, game) && game !== WORDLE_KEY && !linksFor(k, course).some((l) => l.id === game)) throw new k.HttpError(400, 'Unknown game');
        if (on) k.db.prepare('DELETE FROM arcade_class_off WHERE class_id = ? AND game = ?').run(classId, game);
        else k.db.prepare('INSERT OR IGNORE INTO arcade_class_off (class_id, game) VALUES (?, ?)').run(classId, game);
        return { class_id: classId, game, on };
      },
    },
  ],
});
