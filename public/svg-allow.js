// The only SVG a module may ship as an inline building icon: plain shapes and paint. No links (no href of any kind), no
// scripts, no event handlers, no styles, no foreign content, no DTD. Shared by the boot check (lib/modules.js) and the
// browser (public/ui.js), which checks again with a real parser before inserting anything.
export const SVG_ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask',
]);
export const SVG_ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'width', 'height', 'preserveAspectRatio', 'aria-hidden', 'role', 'class', 'id',
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'points', 'pathLength', 'transform',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'color',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'fx', 'fy',
  'clipPathUnits', 'maskUnits', 'clip-path', 'mask', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
]);
// url(#id) is the only url() allowed in a value (gradients, clip paths); anything else with a colon or url() is refused.
export const safeSvgValue = (v) => !/url\s*\((?!\s*['"]?#[\w-]+['"]?\s*\))/i.test(v) && !/[a-z][\w+.-]*\s*:/i.test(v.replace(/url\(\s*['"]?#[\w-]+['"]?\s*\)/gi, ''));

// Text-level check for boot: every tag and attribute name must be on the lists; no <! (DTD, CDATA, entities) and no <?.
export function svgSourceProblem(src) {
  if (typeof src !== 'string' || !src.startsWith('<svg')) return 'must start with <svg';
  if (/<[!?]/.test(src)) return 'may not contain <! or <? (no DTD, CDATA or processing instructions)';
  if (/&/.test(src)) return 'may not contain character references (&...;)';
  for (const [, name] of src.matchAll(/<\/?\s*([A-Za-z][\w:-]*)/g)) if (!SVG_ELEMENTS.has(name)) return `element <${name}> is not allowed`;
  for (const tag of src.match(/<[A-Za-z][^>]*>/g) || []) {
    for (const [, name, , v1, v2] of tag.matchAll(/\s([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      if (!SVG_ATTRIBUTES.has(name)) return `attribute ${name} is not allowed`;
      const v = v1 ?? v2 ?? '';
      if (name !== 'xmlns' && !safeSvgValue(v)) return `attribute ${name} has a disallowed value`;
    }
    if (/=/.test(tag.replace(/\s[^\s=/>]+\s*=\s*("[^"]*"|'[^']*')/g, ''))) return 'attribute values must be quoted';
  }
  return null;
}
