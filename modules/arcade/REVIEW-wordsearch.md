# Word search (working name FinFind): for Mr. Tang to confirm

The words and clues are FinWord's (see `REVIEW-wordle.md`): each clue is a word's lesson meaning, verbatim, with the word blanked, the same text FinWord shows as its last hint. Nothing new to check there.

## Your decisions

1. **Name.** FinFind (working name) or Term Hunt. (Word Vault was dropped: an iPhone word puzzle game already uses it.) One line: `WORDSEARCH_TITLE` in `modules/arcade/wordsearch.js`.
2. **Pay.** Built paying nothing. Option: your FinWord rule, a small fixed Today errand for finishing a puzzle, once a day.
3. **Daily only, or also a replayable practice puzzle.** Built daily only (Easy and Hard each day).

## Student-facing text (new)

- Tile: "A new word search every day. The clues are meanings from your lessons: work out the word, then find it."
- How to play:
  1. Each clue is a meaning from your lessons with the word blanked out. Work out the word, then find it in the grid.
  2. Drag across the letters, or tap the first letter and then the last. On Easy, words run across and down. On Hard they run any way, even backwards.
  3. Stuck? "Show word" tells you the word, and a second tap lights up its first letter. Fewer hints, more stars.
- Buttons and lines: Easy, Hard, Show word, Show first letter, "N of M found.", "Found WORD!", "That is not one of the words. Try again.", "You found that one already.", "Puzzle done", "You used N hints." / "No hints used.", "Try Hard for more words in every direction. A new puzzle comes tomorrow."
