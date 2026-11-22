// A 3x5 pixel font drawn with fillRect (no font files). 15 bits per glyph, rows top to bottom, 3 bits a row. Copied from the arcade game, not imported,
// so the walk module still works in a course that does not enable the arcade.
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011',
  H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101',
  O: '010101101101010', P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100111101111',
  7: '111001010010010', 8: '111101111101111', 9: '111101111001110', $: '011110010011110', '-': '000000111000000', '!': '010010010000010', '.': '000000000000010',
  ':': '000010000010000', '+': '000010111010000', '%': '101001010100101', '/': '001001010100100', ' ': '000000000000000',
};
export function text(ctx, str, x, y, color, size = 1) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of String(str).toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3) * size, y + Math.trunc(i / 3) * size, size, size);
    cx += 4 * size;
  }
  return cx - x - size;                                   // width drawn
}
export const textW = (str, size = 1) => String(str).length * 4 * size - size;
// Text with a 1-px dark outline so it reads on grass and paths.
export function label(ctx, str, x, y, color, size = 1) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) text(ctx, str, x + dx * size, y + dy * size, '#1b2238', size);
  return text(ctx, str, x, y, color, size);
}
