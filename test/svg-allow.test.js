import test from 'node:test';
import assert from 'node:assert/strict';
import { svgSourceProblem } from '../public/svg-allow.js';

test('inline building icons: allowlist refuses every known bypass', () => {
  const bad = [
    '<svg onload="x()"></svg>', '<svg/onload=x()></svg>', '<svg><script>x()</script></svg>',
    '<svg><a href="javascript:x()"><circle r="1"/></a></svg>', '<svg><a href="java&#9;script:x()"><circle/></a></svg>',
    '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>',
    '<svg><use href="data:image/svg+xml,..."/></svg>', '<!DOCTYPE svg [<!ENTITY a "b">]><svg></svg>', '<svg><style>*{}</style></svg>',
    '<svg><circle fill="url(https://evil.example/x)"/></svg>', '<svg><circle style="fill:red"/></svg>', '<svg><circle r=1 /></svg>',
    '<svg><image href="x.png"/></svg>', '<svg><animate attributeName="href" to="javascript:x()"/></svg>',
  ];
  for (const s of bad) assert.ok(svgSourceProblem(s), `should refuse: ${s}`);
});

test('inline building icons: plain shapes, gradients and a missing xmlns are fine', () => {
  const good = [
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-5 9 5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#F5C451"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>',
  ];
  for (const s of good) assert.equal(svgSourceProblem(s), null, s);
});
