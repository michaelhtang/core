// Engine tests must not depend on how much real content exists. This cuts the real course down to the pay unit (ft10-s1-u2):
// every other unit becomes an empty teaser. Built fresh into a temp directory; removed when the process exits.
// Opt in: boot with config.options.learn.contentDir = learnFixture().dir
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PAY_UNIT = 'ft10-s1-u2';

export function learnFixture({ keep = [PAY_UNIT] } = {}) {  // keep: the unit ids that keep their levels (default: the pay unit only)
  const course = JSON.parse(fs.readFileSync(new URL('../modules/learn/content/fintech10.json', import.meta.url), 'utf8'));
  for (const s of course.sections) for (const u of s.units) if (!keep.includes(u.id)) { u.levels = []; delete u.image; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-fixture-'));
  fs.writeFileSync(path.join(dir, 'fintech10.json'), JSON.stringify(course));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  process.once('exit', cleanup);
  return { dir, cleanup, course };
}
