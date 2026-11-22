// Module contract v2 (docs/modules.md). A module is modules/<id>/index.js with `export default defineModule({ ... })`;
// config/vdaa.json lists which modules each course enables. defineModule validates the shape and fails boot with
// `module "<id>": <field>: <problem>`; loadModules imports, orders (requires), migrates, wires hooks/events and builds the registry.
// Modules receive the kernel facade `k` (lib/kernel.js), never `app`.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate, withTxn } from './db.js';
import { HttpError } from './errors.js';
import { createKernel, recordFailure } from './kernel.js';

const ID = /^[a-z][a-z0-9-]{1,30}$/;
const ACCESS = ['student', 'teacher', 'any', 'public'];
const HOOKS = ['onPlayer', 'onLogin', 'onEnable', 'onTick', 'simulate', 'seasonAssets', 'seasonClose', 'badges', 'homeCards', 'ownersOf'];   // simulate: bots only, called by scripts/sim.mjs
const FIELDS = new Set(['id', 'requires', 'migrations', 'routes', 'panels', 'teacherPanels', 'cards', 'events', 'catalogues', 'options', 'services', 'needs', ...HOOKS]);
const NEEDS = ['world.setPace'];                   // facade powers a module must declare (docs/modules.md section 3); everyone else's k lacks them
const NAME = /^[a-z][a-z0-9_]*$/;                 // a table or column name in a catalogue (it is spliced into SQL)
const V1_EXPORTS = ['id', 'routes', 'panels', 'migrations', 'teacherPanels', 'events', ...HOOKS];
const SRC = /^[\w-]+(\/[\w-]+)*(\.[\w-]+)+$/;     // a file under modules/<id>/ui/, no ".." and no leading "/"
import { svgSourceProblem } from '../public/svg-allow.js';   // same allowlist the browser re-checks with a real parser
const CARD_BYTES = 8192, CARDS_PER_MODULE = 2;     // homeCards: a card's data as JSON, and how many cards one module may show
const RESERVED = new Set(['me', 'setup', 'login', 'logout', 'stream', 'accounts', 'teach', 'preview']);   // /api/<id> names core routes already use
const defined = new WeakSet();

const freeze = (o) => Object.freeze(o);

export function defineModule(spec) {
  const id = typeof spec?.id === 'string' ? spec.id : '?';
  const bad = (field, problem) => { throw new Error(`module "${id}": ${field}: ${problem}`); };
  const text = (v, field) => (typeof v === 'string' && v.trim() ? v : bad(field, 'must be a non-empty string'));
  const listOf = (field) => (spec[field] === undefined ? [] : Array.isArray(spec[field]) ? spec[field] : bad(field, 'must be an array'));
  const record = (v, field) => (v && typeof v === 'object' && !Array.isArray(v) ? v : bad(field, 'must be an object'));

  record(spec, '(spec)');
  if (typeof spec.id !== 'string' || !ID.test(spec.id)) bad('id', 'must match /^[a-z][a-z0-9-]{1,30}$/');
  for (const k of Object.keys(spec)) if (!FIELDS.has(k)) bad(k, 'unknown field');
  for (const h of HOOKS) if (spec[h] !== undefined && typeof spec[h] !== 'function') bad(h, 'must be a function');

  const requires = listOf('requires').map((r, i) => (typeof r === 'string' && ID.test(r) ? r : bad(`requires[${i}]`, 'must be a module id')));

  const seenMig = new Set();
  const migrations = listOf('migrations').map((m, i) => {
    const f = `migrations[${i}]`;
    record(m, f);
    if (typeof m.id !== 'string' || !/^\d{3}_[a-z0-9_]+$/.test(m.id)) bad(`${f}.id`, 'must look like 001_name (/^\\d{3}_[a-z0-9_]+$/)');
    if (seenMig.has(m.id)) bad(`${f}.id`, `duplicate migration "${m.id}"`);
    seenMig.add(m.id);
    return freeze({ id: m.id, sql: text(m.sql, `${f}.sql`) });
  });

  const seenRoute = new Set();
  const routes = listOf('routes').map((r, i) => {
    const f = `routes[${i}]`;
    record(r, f);
    if (r.method !== 'GET' && r.method !== 'POST') bad(`${f}.method`, 'must be GET or POST');
    if (typeof r.path !== 'string' || !r.path.startsWith('/') || !/^[\w\-/:]+$/.test(r.path) || /:(?!\w)/.test(r.path)) bad(`${f}.path`, 'must start with "/" and use only letters, digits, _ - / and :name');
    if (!ACCESS.includes(r.access)) bad(`${f}.access`, `is required: one of ${ACCESS.join(' | ')}`);
    if (typeof r.handler !== 'function') bad(`${f}.handler`, 'must be a function');
    if (seenRoute.has(`${r.method} ${r.path}`)) bad(f, `duplicate route ${r.method} ${r.path}`);
    seenRoute.add(`${r.method} ${r.path}`);
    return freeze({ method: r.method, path: r.path, access: r.access, handler: r.handler });
  });

  const panelBase = (p, f) => {
    record(p, f);
    if (typeof p.id !== 'string' || !/^[a-z][\w-]*$/.test(p.id)) bad(`${f}.id`, 'must be a plain name');
    if (typeof p.src !== 'string' || !SRC.test(p.src)) bad(`${f}.src`, 'must be a file name under modules/<id>/ui/');
    return { id: p.id, src: p.src };
  };
  const panels = listOf('panels').map((p, i) => {
    const f = `panels[${i}]`;
    const base = panelBase(p, f);
    const b = record(p.building, `${f}.building`);
    if (typeof b.key !== 'string' || !/^[a-z][a-z0-9-]*$/.test(b.key)) bad(`${f}.building.key`, 'must be a lowercase name (it is used in the URL hash)');
    text(b.name, `${f}.building.name`);
    if (typeof b.icon !== 'string') bad(`${f}.building.icon`, 'must be a core icon name or an inline <svg> string');
    else if (b.icon.startsWith('<svg')) { const why = svgSourceProblem(b.icon); if (why) bad(`${f}.building.icon`, `inline <svg> ${why} (see public/svg-allow.js)`); }
    else if (!/^[a-z][a-z0-9-]*$/.test(b.icon)) bad(`${f}.building.icon`, 'must be a core icon name or an inline <svg> string');
    return freeze({ ...base, building: freeze({ key: b.key, name: b.name, icon: b.icon }) });
  });
  const teacherPanels = listOf('teacherPanels').map((p, i) => freeze({ ...panelBase(p, `teacherPanels[${i}]`), title: text(p.title, `teacherPanels[${i}].title`) }));
  // cards: [{ id, src }]: the renderer (modules/<id>/ui/<src>, exporting renderCard) of each home card the homeCards hook may return.
  const cards = listOf('cards').map((c, i) => freeze(panelBase(c, `cards[${i}]`)));
  if (cards.length && !spec.homeCards) bad('cards', 'needs a homeCards hook');

  const events = spec.events === undefined ? {} : record(spec.events, 'events');
  for (const [type, fn] of Object.entries(events)) if (!type || typeof fn !== 'function') bad(`events.${type}`, 'must be a function');

  // catalogues: [{ table, key: [columns], rows() }], upserted at every boot (docs/modules.md "Catalogues"). options: { key: 'what it does' }.
  const catalogues = listOf('catalogues').map((c, i) => {
    const f = `catalogues[${i}]`;
    record(c, f);
    if (typeof c.table !== 'string' || !NAME.test(c.table) || !c.table.startsWith(`${spec.id.replaceAll('-', '_')}_`)) bad(`${f}.table`, `must be one of this module's tables (${spec.id.replaceAll('-', '_')}_...)`);
    if (!Array.isArray(c.key) || !c.key.length || c.key.some((k) => typeof k !== 'string' || !NAME.test(k))) bad(`${f}.key`, 'must be a non-empty array of column names');
    if (typeof c.rows !== 'function') bad(`${f}.rows`, 'must be a function returning the rows');
    return freeze({ table: c.table, key: freeze([...c.key]), rows: c.rows });
  });
  // services: { name(k, args, { from }) } other modules call with k.modules.call('<id>', '<name>', args) (docs/modules.md "Services").
  const services = spec.services === undefined ? {} : record(spec.services, 'services');
  for (const [name, fn] of Object.entries(services)) if (!/^[a-z][A-Za-z0-9]*$/.test(name) || typeof fn !== 'function') bad(`services.${name}`, 'must be a function with a camelCase name');
  const options = spec.options === undefined ? {} : record(spec.options, 'options');
  for (const [key, what] of Object.entries(options)) if (typeof what !== 'string') bad(`options.${key}`, 'must be a description string');

  const needs = listOf('needs').map((n, i) => (NEEDS.includes(n) ? n : bad(`needs[${i}]`, `must be one of ${NEEDS.join(', ')}`)));

  const def = freeze({
    id: spec.id, requires: freeze(requires), needs: freeze(needs), migrations: freeze(migrations), routes: freeze(routes), panels: freeze(panels),
    teacherPanels: freeze(teacherPanels), cards: freeze(cards), events: freeze({ ...events }), catalogues: freeze(catalogues), options: freeze({ ...options }), services: freeze({ ...services }),
    ...Object.fromEntries(HOOKS.filter((h) => spec[h]).map((h) => [h, spec[h]])),
  });
  defined.add(def);
  return def;
}

async function importModule(modulesDir, id) {
  if (!ID.test(id)) throw new Error(`module "${id}": id: must match /^[a-z][a-z0-9-]{1,30}$/ (config/vdaa.json)`);
  if (RESERVED.has(id)) throw new Error(`module "${id}": id: reserved by core (/api/${id} is a core route)`);
  const file = path.join(modulesDir, id, 'index.js');
  if (!fs.existsSync(file)) throw new Error(`module "${id}": no such file ${path.join('modules', id, 'index.js')}`);
  const ns = await import(pathToFileURL(file));
  const old = V1_EXPORTS.filter((n) => n in ns);
  if (old.length) throw new Error(`module "${id}": uses the v1 export shape (export ${old.join(', ')}); use \`export default defineModule({ ... })\`, see docs/modules.md`);
  if (!defined.has(ns.default)) throw new Error(`module "${id}": default export must be the result of defineModule(), see docs/modules.md`);
  if (ns.default.id !== id) throw new Error(`module "${id}": id: "${ns.default.id}" must equal the folder name`);
  return ns.default;
}

// Dependencies first; otherwise the order of config/vdaa.json is kept.
function sortByRequires(defs) {
  const order = [];
  const state = new Map();
  const visit = (id, stack) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'busy') throw new Error(`module "${id}": requires: dependency cycle ${[...stack.slice(stack.indexOf(id)), id].join(' -> ')}`);
    state.set(id, 'busy');
    for (const dep of defs.get(id).requires) {
      if (!defs.has(dep)) throw new Error(`module "${id}": requires: "${dep}" is not loaded (enable it for a course in config/vdaa.json)`);
      visit(dep, [...stack, id]);
    }
    state.set(id, 'done');
    order.push(id);
  };
  for (const id of defs.keys()) visit(id, []);
  return order;
}

// Catalogue rows (wages, prices, items) live in code; boot writes them into the module's tables so an edit plus a restart applies it.
// Insert new keys, update changed columns of existing keys, never delete (player rows reference them). A table with an `active` column
// gets active = 1 for every row in the file and active = 0 for keys no longer in it (retired: not offered again, kept for history).
function upsertCatalogue(db, id, { table, key, rows }) {
  const where = `module "${id}": catalogue ${table}`;
  const list = rows();
  if (!Array.isArray(list) || !list.length) throw new Error(`${where}: rows() must return a non-empty array`);
  const cols = Object.keys(list[0]);
  if (cols.some((c) => !NAME.test(c)) || key.some((k) => !cols.includes(k))) throw new Error(`${where}: bad columns ${cols.join(', ')}`);
  const shape = [...cols].sort().join(',');
  list.forEach((r, i) => { if (Object.keys(r).sort().join(',') !== shape) throw new Error(`${where}: row ${i} (${key.map((k) => r[k]).join('/')}) has columns ${Object.keys(r).join(', ')}; every row needs exactly ${cols.join(', ')}`); });
  const hasActive = !cols.includes('active') && db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'active');
  const all = hasActive ? [...cols, 'active'] : cols;
  const set = all.filter((c) => !key.includes(c));
  const sql = `INSERT INTO ${table} (${all.join(', ')}) VALUES (${all.map(() => '?').join(', ')}) ON CONFLICT (${key.join(', ')}) DO ${set.length
    ? `UPDATE SET ${set.map((c) => `${c} = excluded.${c}`).join(', ')} WHERE (${set.map((c) => `${table}.${c}`).join(', ')}) IS NOT (${set.map((c) => `excluded.${c}`).join(', ')})`
    : 'NOTHING'}`;
  const stmt = db.prepare(sql);
  const keyOf = (r) => JSON.stringify(key.map((k) => r[k]));
  let changed = 0;
  const retired = [];
  withTxn(db, () => {
    for (const r of list) changed += stmt.run(...cols.map((c) => r[c] ?? null), ...(hasActive ? [1] : [])).changes;
    if (!hasActive) return;
    const inFile = new Set(list.map(keyOf));
    const retire = db.prepare(`UPDATE ${table} SET active = 0 WHERE ${key.map((k) => `${k} = ?`).join(' AND ')}`);
    for (const r of db.prepare(`SELECT ${key.join(', ')} FROM ${table} WHERE active = 1`).all()) {
      if (!inFile.has(keyOf(r))) { retire.run(...key.map((k) => r[k])); retired.push(key.map((k) => r[k]).join('/')); }
    }
  });
  return { changed, retired };
}

const failed = (k, id, hook, e) => { k.log.error(`${hook} failed`, e); return new HttpError(500, `module "${id}": ${hook} failed: ${e.message}`); };

export async function loadModules(app, modulesDir) {
  const { config, db } = app;
  const ids = [...new Set(Object.values(config.courses).flatMap((c) => c.modules))];
  const defs = new Map();
  for (const id of ids) defs.set(id, await importModule(modulesDir, id));
  const order = sortByRequires(defs);

  const buildings = new Map();
  for (const id of order) {
    defs.get(id).panels.forEach((p, i) => {
      const other = buildings.get(p.building.key);
      if (other) throw new Error(`module "${id}": panels[${i}].building.key: "${p.building.key}" is already used by module "${other}"`);
      buildings.set(p.building.key, id);
    });
  }

  // A service call: synchronous, in the caller's transaction (a savepoint, so a throw undoes only the callee's writes and reaches the caller),
  // or in a new one when none is open. Args and the result are structured-cloned: plain data only (a function throws DataCloneError).
  const kernels = new Map();
  const services = {
    has: (id) => defs.has(id),
    call(from, id, name, args) {
      const fn = defs.has(id) ? (Object.hasOwn(defs.get(id).services, name) ? defs.get(id).services[name] : null) : undefined;
      if (fn === undefined) throw new Error(`module "${from}": k.modules.call: module "${id}" is not loaded (check k.modules.has('${id}') first)`);
      if (!fn) throw new Error(`module "${from}": k.modules.call: module "${id}" has no service "${name}"`);
      const input = structuredClone(args);
      return withTxn(db, () => structuredClone(fn(kernels.get(id), input, { from })));   // cloned inside: an unclonable return rolls the service back
    },
  };
  for (const id of order) {
    const def = defs.get(id);
    migrate(db, def.migrations.map((m) => ({ id: `mod:${id}:${m.id}`, sql: m.sql })));
    for (const c of def.catalogues) {
      const { changed, retired } = upsertCatalogue(db, id, c);
      if (changed) console.log(`[${id}] catalogue ${c.table}: ${changed} row(s) added or updated`);
      if (retired.length) console.log(`[${id}] catalogue ${c.table}: retired (no longer in the file): ${retired.join(', ')}`);
    }
    kernels.set(id, createKernel(app, id, services, def.needs));
  }

  // Options: config.options.<id> may only use the keys the module declares (a typo would otherwise be silently ignored).
  for (const [id, opts] of Object.entries(config.options ?? {})) {
    const declared = defs.get(id)?.options;
    if (!declared) {                                   // not enabled for any course: fine, unless there is no such module at all (a typo)
      if (!fs.existsSync(path.join(modulesDir, id, 'index.js'))) console.warn(`config: options.${id}: there is no module "${id}"; these options are ignored`);
      continue;
    }
    for (const key of Object.keys(opts ?? {})) if (!Object.hasOwn(declared, key)) console.warn(`config: options.${id}.${key} is not an option of module "${id}" (known: ${Object.keys(declared).join(', ') || 'none'}); it is ignored`);
  }

  const enabledFor = (course) => (Object.hasOwn(config.courses, course) ? config.courses[course].modules : null) ?? [];
  const coursesWith = (id) => Object.keys(config.courses).filter((c) => enabledFor(c).includes(id));
  const active = (course) => order.filter((id) => enabledFor(course).includes(id));    // load order

  for (const id of order) {
    const def = defs.get(id);
    const k = kernels.get(id);
    for (const [type, fn] of Object.entries(def.events)) {
      // An event emitted inside a transaction (a tick, a payment) reaches this listener inside it: the listener runs in its own savepoint,
      // so a throw undoes only its own writes (the emitter's stay), and is recorded for the world teacher. Outside a transaction: logged only.
      // If SQLite aborted the whole transaction (disk full), the emitter must not carry on outside it: the error goes to the emitter.
      app.events.on(type, (payload, evType) => {
        if (!db.isTransaction) { try { fn(k, payload, evType); } catch (e) { k.log.error(`listener for ${type} failed`, e); } return; }
        try { withTxn(db, () => fn(k, payload, evType)); } catch (e) {
          if (!db.isTransaction) throw Object.assign(new Error(`module "${id}": listener for ${type} failed and the transaction was aborted: ${e?.message ?? e}`, { cause: e }), { toEmitter: true });
          recordFailure(app, id, payload?.playerId, e, `listener for ${type}`);
        }
      });
    }
    if (def.onTick) {
      app.world.onTick(id, ({ month, world, startMonth = month - 1 }) => {
        const inCourses = JSON.stringify(coursesWith(id));
        const classes = db.prepare('SELECT id, course_id FROM classes WHERE world_id = ? AND archived IS NULL AND course_id IN (SELECT value FROM json_each(?)) ORDER BY id').all(world.id, inCourses)
          .map((c) => ({ id: c.id, course_id: c.course_id, studentIds: [] }));
        const byId = new Map(classes.map((c) => [c.id, c]));
        // A removed student (class_id NULL, lib/players.js detach) is in no class, so no module's tick sees them.
        for (const s of db.prepare("SELECT id, class_id FROM players WHERE role = 'student' AND class_id IN (SELECT id FROM classes WHERE world_id = ? AND archived IS NULL AND course_id IN (SELECT value FROM json_each(?))) ORDER BY id").all(world.id, inCourses)) {
          byId.get(s.class_id)?.studentIds.push(s.id);
        }
        try { def.onTick(k, { month, from: month - 1, startMonth, world, classes }); } catch (e) { throw failed(k, id, 'onTick', e); }
      });
    }
  }

  // onEnable: once per (module, class). Hook and bookkeeping row commit together, so a failure is retried at the next boot
  // (or the next class.created). Only modules that define onEnable are tracked.
  function runEnables() {
    for (const id of order) {
      const def = defs.get(id);
      if (!def.onEnable) continue;
      const classIds = db.prepare('SELECT id FROM classes WHERE archived IS NULL AND course_id IN (SELECT value FROM json_each(?)) AND id NOT IN (SELECT class_id FROM module_enabled WHERE module_id = ?) ORDER BY id')
        .all(JSON.stringify(coursesWith(id)), id).map((c) => c.id);
      if (!classIds.length) continue;
      try {
        withTxn(db, () => {
          def.onEnable(kernels.get(id), { classIds });
          const ins = db.prepare('INSERT INTO module_enabled (module_id, class_id, at) VALUES (?, ?, ?)');
          for (const c of classIds) ins.run(id, c, app.clock.now());
        });
      } catch (e) { kernels.get(id).log.error('onEnable failed (retried next boot)', e); }
    }
  }
  app.events.on('class.created', runEnables);
  runEnables();

  const student = (p) => ({ id: p.id, username: p.username, role: 'student', class_id: p.class_id });
  return {
    ids: order, has: (id) => defs.has(id), enabledFor, coursesWith,
    kernel: (id) => kernels.get(id),
    // Each handler is already bound to its module's k: handler({ user, body, params, url }).
    routes: () => order.flatMap((id) => defs.get(id).routes.map((r) => ({ ...r, module: id, fullPath: `/api/${id}${r.path}`, handler: (ctx) => r.handler(kernels.get(id), ctx) }))),
    panelsFor: (course, version) => active(course).flatMap((id) => defs.get(id).panels.map((p) => ({ module: id, id: p.id, building: p.building, src: `/m/${id}/${p.src}?v=${version}` }))),
    // courses (optional): only modules enabled for at least one of them; omitted = every loaded module.
    teacherPanels: (version, courses) => order.filter((id) => !courses || courses.some((c) => enabledFor(c).includes(id))).flatMap((id) => defs.get(id).teacherPanels.map((p) => ({ module: id, id: p.id, title: p.title, src: `/m/${id}/${p.src}?v=${version}` }))),
    onPlayer(player, course) {
      for (const id of active(course)) {
        try { defs.get(id).onPlayer?.(kernels.get(id), student(player)); } catch (e) { throw failed(kernels.get(id), id, 'onPlayer', e); }
      }
    },
    // Season close (lib/world.js, inside its transaction): every module's non-money assets per player, e.g. housing's homes. [{ playerId, cents }].
    // A throw fails the close with the module named; bad rows are refused the same way, so a season result is never silently wrong.
    // A student's header chips (e.g. a rank): each enabled module's badges(k, user) → [{ text, title? }]. A failing module is skipped and
    // logged, so a badge can never break /api/me. Text is plain (the client renders it with textContent), at most 3 chips per module.
    badgesFor(player, course) {
      return active(course).flatMap((id) => {
        const def = defs.get(id);
        if (!def.badges) return [];
        try {
          const rows = def.badges(kernels.get(id), student(player));
          return (Array.isArray(rows) ? rows : []).filter((b) => typeof b?.text === 'string' && b.text.length <= 40).slice(0, 3)
            .map((b) => ({ module: id, text: b.text, ...(typeof b.title === 'string' ? { title: b.title.slice(0, 120) } : {}) }));
        } catch (e) { kernels.get(id).log.error('badges failed', e); return []; }
      });
    },
    // Cards above the doors on the student's home screen: each enabled module's homeCards(k, user) -> [{ id, title, data }]. id must be one
    // of the module's declared `cards` (that names the renderer script), title plain text <= 60, data plain JSON <= 8 KB, at most 2 per module.
    // A throwing module, or a card that breaks a rule, is skipped and logged, so a card can never break /api/me.
    homeCardsFor(player, course, version) {
      return active(course).flatMap((id) => {
        const def = defs.get(id);
        if (!def.homeCards) return [];
        try {
          const rows = def.homeCards(kernels.get(id), student(player));
          return (Array.isArray(rows) ? rows : []).slice(0, CARDS_PER_MODULE).flatMap((c) => {
            const decl = def.cards.find((d) => d.id === c?.id);
            let json;
            try { json = JSON.stringify(c.data ?? null); } catch { json = undefined; }
            const why = !decl ? `card "${c?.id}" is not declared in cards` : typeof c.title !== 'string' || !c.title.trim() || c.title.length > 60 ? `card "${c.id}": title must be 1-60 characters`
              : json === undefined || Buffer.byteLength(json) > CARD_BYTES ? `card "${c.id}": data must be plain JSON of at most ${CARD_BYTES} bytes` : null;
            if (why) { kernels.get(id).log.error(`homeCards: ${why}; skipped`); return []; }
            return [{ module: id, id: c.id, title: c.title, data: JSON.parse(json), src: `/m/${id}/${decl.src}?v=${version}`, ...(c.lead === true ? { lead: true } : {}) }];
          });
        } catch (e) { kernels.get(id).log.error('homeCards failed', e); return []; }
      });
    },
    seasonAssets(worldId) {
      return order.flatMap((id) => {
        const def = defs.get(id);
        if (!def.seasonAssets) return [];
        let rows;
        try { rows = def.seasonAssets(kernels.get(id), { worldId }); } catch (e) { throw failed(kernels.get(id), id, 'seasonAssets', e); }
        if (!Array.isArray(rows) || rows.some((r) => !Number.isSafeInteger(r?.playerId) || !Number.isSafeInteger(r?.cents))) throw new HttpError(500, `module "${id}": seasonAssets must return [{ playerId, cents }] (integers)`);
        return rows;
      });
    },
    // Who should hear about an account owned by a non-player (a business): each module's ownersOf(k, { type, id }) -> [playerId], merged.
    // The server sends those students the `balance` hint (server.js). A throwing module is logged and skipped: it is only a hint.
    ownersOf(owner) {
      const ids = new Set();
      for (const id of order) {
        const def = defs.get(id);
        if (!def.ownersOf) continue;
        try { for (const p of def.ownersOf(kernels.get(id), { type: owner.type, id: owner.id }) ?? []) if (Number.isSafeInteger(p)) ids.add(p); } catch (e) { kernels.get(id).log.error('ownersOf failed', e); }
      }
      return [...ids];
    },
    // Season close (lib/world.js), last step of its transaction: season_results are final, every player and business account is zeroed and the world is
    // marked closed. Each module ends its season state here (jobs' wages, leaderboards' finale). A throw rolls the whole close back.
    seasonClose(world) {
      for (const id of order) {
        try { defs.get(id).seasonClose?.(kernels.get(id), { world }); } catch (e) { throw failed(kernels.get(id), id, 'seasonClose', e); }
      }
    },
    // Bots only (scripts/sim.mjs), once per world month before it advances: each module plays its part for the bots in its courses.
    simulate({ month, students }) {
      for (const id of order) {
        const def = defs.get(id);
        if (!def.simulate) continue;
        const mine = students.filter((s) => coursesWith(id).includes(s.course_id)).map(({ id: sid, class_id }) => ({ id: sid, class_id }));
        if (mine.length) def.simulate(kernels.get(id), { month, students: mine });
      }
    },
    // Not while the season is closed: a grant paid after the reset would carry into the next season on top of its own grant.
    // Returns true when every hook ran without throwing (so the caller may record the world as entered), false otherwise.
    onLogin(player, course) {
      if (app.world.current()?.status !== 'active') return false;
      let ok = true;
      for (const id of active(course)) {
        try { defs.get(id).onLogin?.(kernels.get(id), student(player)); } catch (e) { ok = false; kernels.get(id).log.error('onLogin failed; login proceeds', e); }
      }
      return ok;
    },
  };
}
