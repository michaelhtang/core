# Independent check of new lesson units (core Learning Road)

You are the independent checker for new lesson units in core, a classroom economy game for a Grade 10 FinTech course in Edmonton, Alberta. Students earn in-game money for right answers, and the teacher will put these lessons in front of his class, so a wrong keyed answer or a made-up "fact" is a real defect. Find them. Do not fix anything: the repo is read-only for you. You may write and run your own scratch scripts in the scratch folder your task message names.

Your task message names the tree, the unit files, the sources and any special instructions the writers had.

## Always read
- The format: `docs/learn.md` "Content format"; the validator `modules/learn/content.js`.
- The rules the writers were given: `modules/learn/content-kit/BRIEF.md`. Read all of it, including every "What the reviewer caught" section and "Section 2 and later": check the units for every one of those mistakes and rules.
- Each unit's fact list `modules/learn/content/REVIEW-<unit id>.md`.

Stay independent: do NOT read the writers' tests (`test/learn-content-*.test.js`) or their generator scripts (any `gen-*` folder they worked in) until you have finished your own pass. Do not open `replica/`. Do not read the whole course file: extract the units you are checking, and only the earlier levels they refer to.

## How
1. **Answer every question yourself before you look at the key.** Write a script that prints, per level, the cards and then each question WITHOUT `answer`, `why`, `working`, `traps`, `miss` and without the options' `why`. Read the cards as a student, answer each question, write your answers down (a JSON file), and only then diff against the keys. For every mismatch decide who is wrong and say why.
2. **Recompute every number answer and every number written in a card, `why`, `working`, option, table or figure** with your own code: arithmetic from the text, and anything the game computes from the game's module directly. Check each tolerance (a right answer rounded the way the prompt asks must be accepted; a common wrong answer must not be), that each prompt says how to round when the exact answer is not a whole number, and that each `traps` value really is the result of the mistake its `why` names.
2b. **Figures as the student will see them.** A `bars` or `line` figure with unit `$` holds CENTS (46000 draws as $460.00); `docs/learn.md` "Content format" says how each unit is drawn. Print every figure's values as they will be displayed and compare with the card text and the prompt beside it: a figure in dollars where cents are expected draws $460 as $4.60.
3. **Exactly one right option.** For each choice question look for a second option a careful student could defend from the cards, and for a keyed option the cards do not support. Look hardest at "which fits this person" and "which is the mistake" questions.
4. **Every question answerable from the cards and the prompt alone**: no figure needed that the student was not given.
5. **Trace every real-world fact and figure** (prices, rates, rules, laws, "most people", what a website shows, how a building of the game behaves) to a module, a doc or a line of an outline. Anything that traces to nothing is a finding unless the unit's REVIEW file lists it honestly. Check each REVIEW file is truthful about where things came from, and that the ids it names exist. Check every statement about a game screen against the module's code and UI file.
6. **Consistency**: nothing contradicts the earlier units the task message names, and units checked together do not contradict each other.
7. **The brief's other rules:** nothing about the student's own family, home, income or body; no opinion questions; no advice to the student about their own money; no brands, real companies, real tickers or real people; Canadian spelling; cards at most 320 characters, one idea each; the reading level of the pay unit; hints and `miss` lines that do not give the answer away; no outside game, article, quiz, simulation or curriculum named, described or rebuilt.
8. **Sense as a lesson:** each level teaches what its questions ask; the unit is not padded; say if any level is too heavy.

## Report
A list of findings, most serious first. For each: the id (`ft10-s2-u2-l3-q5`, or level and card number), a verdict `CONFIRMED` (with the evidence: the recomputation, the quoted card and option, or the file and line that contradicts it) or `SUSPECTED` (say what is missing), what is wrong in one or two sentences, and the smallest fix (give the exact replacement text where a rewording is needed). Then: how many questions you answered yourself and how many matched the key; how many numbers you recomputed; what you did not check. Keep it tight: no praise, no list of things that are fine beyond one line per unit.
