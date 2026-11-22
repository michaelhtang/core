import fs from 'node:fs';

// A module's server-side code may be split over several files (index.js plus topic files beside it), so a test that checks a module's
// source text reads every .js file directly in modules/<id>/. The ui/ folder is browser code and is not included.
const dirOf = (id) => new URL(`../modules/${id}/`, import.meta.url);
export const moduleFiles = (id) => fs.readdirSync(dirOf(id)).filter((f) => f.endsWith('.js')).sort();
export const moduleSource = (id, file) => (file ? fs.readFileSync(new URL(file, dirOf(id)), 'utf8') : moduleFiles(id).map((f) => moduleSource(id, f)).join('\n'));
