/** Tiny DOM helper: el('div', 'cls', 'inner html') */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  html = '',
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
