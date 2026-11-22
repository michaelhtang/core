import fs from 'node:fs';
import './levels-a.mjs';
import './levels-b.mjs';
import { levels, U } from './gen-lib.mjs';
const WT = '/Users/michaeltang/claude-workspace/vdaa/.worktrees/p13-learn';
const { checkCourse } = await import(`${WT}/modules/learn/content.js`);

const soon = (id, title, blurb) => ({ id, title, blurb, outcome_codes: [], levels: [] });
const course = {
  id: 'fintech10', title: 'FinTech 10',
  sections: [{
    id: 'ft10-s1', title: 'Money & You', blurb: 'Where money comes from, what you keep, and how to plan a month.',
    units: [
      soon('ft10-s1-u1', 'Being responsible with money', 'What it means to be financially responsible, and where your habits come from.'),
      { id: U, title: 'Gross pay to net pay', blurb: 'From the pay on a job offer to the money that lands in your account.', outcome_codes: ['FIN1010 2.1', 'FIN1010 2.3'], levels },
      soon('ft10-s1-u3', 'Careers and pathways', 'Pick a career, find what it pays, and see the way there.'),
      soon('ft10-s1-u4', 'What Edmonton costs', 'The real cost of living in Edmonton: where you live and how you get around.'),
      soon('ft10-s1-u5', 'Budget methods', 'Three ways to budget: 50/30/20, zero-based and envelopes.'),
      soon('ft10-s1-u6', 'Build your budget', 'Build a monthly budget on the net pay of a career you chose.'),
    ],
  }],
};
const problems = [];
try { checkCourse(course, 'build'); } catch (e) { problems.push(e.message); }
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
const out = `${WT}/modules/learn/content/fintech10.json`;
fs.writeFileSync(out, JSON.stringify(course, null, 2) + '\n');
const qs = levels.flatMap((l) => l.questions), by = (t) => qs.filter((q) => q.type === t).length;
console.log(`wrote ${out}: ${levels.length} levels, ${levels.reduce((n, l) => n + l.cards.length, 0)} cards, ${qs.length} questions (choice ${by('choice')}, point ${by('point')}, number ${by('number')}), figures ${qs.filter((q) => q.figure).length}`);
