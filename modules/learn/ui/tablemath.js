// Which columns of a lesson table are numbers. Pure (no DOM), so test/learn-table.test.js can run it; figures.js draws with it.
// A column after the first is a NUMBER column (right-aligned, never wrapped) when its cells are short amounts: at least two in three of
// its filled cells start with a number or a money sign and are 16 characters or fewer, and none is a phrase (over 24 characters). Every
// other column reads left and wraps: the Account column of a journal, and columns of phrases that only mention a number ("1 cent adds $3").
const AMOUNT = /^[+\-−]?\s*(?:US|C)?\$?\s*[+\-−]?\d/;
export function numberColumn(rows, i) {
  if (i === 0) return false;
  const cells = rows.map((r) => String(r[i] ?? '').trim()).filter((x) => x && !/^[-–—?]+$/.test(x));   // a dash or "?" is a blank
  if (!cells.length) return rows.some((r) => /^\?+$/.test(String(r[i] ?? '').trim()));   // nothing but a "?": the question asks for the amount that goes there
  if (cells.some((x) => x.length > 24)) return false;
  return cells.filter((x) => x.length <= 16 && AMOUNT.test(x)).length * 3 >= cells.length * 2;
}
