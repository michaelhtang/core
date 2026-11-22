// node scripts/learn-unlock-to.mjs <vdaa.db> <username> <level id>   For a local preview database only, never the live one: marks every level BEFORE the given level (road order) done, no money paid,
// closes open attempts, so the given level is the next one on the road.
import { DatabaseSync } from 'node:sqlite'; import fs from 'node:fs';
const COURSE = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
const [DB, username, target] = process.argv.slice(2);
if (!target) { console.error('usage: node scripts/learn-unlock-to.mjs <vdaa.db> <username> <level id>'); process.exit(1); }
const road = COURSE.sections.flatMap((s) => s.units).flatMap((u) => u.levels);
const at = road.findIndex((l) => l.id === target); if (at < 0) throw new Error(`no level ${target}`);
const db = new DatabaseSync(DB);
const player = db.prepare('SELECT id FROM players WHERE username = ?').get(username); if (!player) throw new Error(`no player ${username}`);
const world = db.prepare("SELECT id FROM worlds WHERE status = 'active'").get(); if (!world) throw new Error('no active world');
const ins = db.prepare('INSERT OR IGNORE INTO learn_progress (player_id, world_id, level_id, first_try, questions, best_first_try, done_at, paid_cents) VALUES (?, ?, ?, ?, ?, ?, ?, 0)');
let n = 0;
for (const l of road.slice(0, at)) n += Number(ins.run(player.id, world.id, l.id, l.questions.length, l.questions.length, l.questions.length, Date.now()).changes);
db.prepare('UPDATE learn_attempts SET finished_at = ? WHERE player_id = ? AND world_id = ? AND finished_at IS NULL').run(Date.now(), player.id, world.id);
console.log(`${username}: ${n} more levels marked done; next is ${target} (${road[at].title})`);
db.close();
