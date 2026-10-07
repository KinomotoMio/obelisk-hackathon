// Building the page from text nodes only: no HTML strings anywhere, so
// names and descriptions written by Skill authors can never become markup.

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(node, attrs) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** An HTML element: h('a', { href, class }, 'text', child…). */
export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  apply(node, attrs);
  append(node, children);
  return node;
}

/** An SVG element. */
export function s(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  apply(node, attrs);
  append(node, children);
  return node;
}

export function replace(target, ...children) {
  target.replaceChildren();
  append(target, children);
}

/** A link that only ever points at http(s) URLs or this site's paths. */
export function link(href, attrs, ...children) {
  if (typeof href !== 'string' || !(/^https?:\/\//.test(href) || href.startsWith('/'))) return h('span', { class: attrs?.class }, ...children);
  const external = /^https?:\/\//.test(href);
  return h('a', { ...attrs, href, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, ...children);
}
