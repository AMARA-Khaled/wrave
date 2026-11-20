/**
 * In-page JavaScript snippets shared by the CDP engine.
 * Each export is source text meant to be embedded in a Runtime.evaluate expression.
 */
/**
 * `function(sel) -> Element | null`
 * Resolves an element from:
 *   - "@12"            ref assigned by the last snapshot
 *   - "text:Sign in"   first visible, clickable element whose text / aria-label / placeholder matches
 *   - any CSS selector
 */
export const RESOLVE_FN = `function wraveResolve(sel) {
  if (!sel) return null;
  if (sel.startsWith('@')) return document.querySelector('[data-wrave-ref="' + sel + '"]');
  if (/^text[:=]/i.test(sel)) {
    const q = sel.replace(/^text[:=]/i, '').trim().toLowerCase();
    const label = (e) => ((e.innerText || e.value || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('placeholder') || '') + ' ' + (e.getAttribute('title') || '')).trim().replace(/\\s+/g, ' ').toLowerCase();
    const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const clickable = Array.from(document.querySelectorAll('a, button, input, textarea, select, label, summary, [role], [onclick], [contenteditable="true"], [tabindex]')).filter(visible);
    return clickable.find((e) => label(e) === q)
      || clickable.find((e) => label(e).includes(q))
      || Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && visible(e)).find((e) => label(e).includes(q))
      || null;
  }
  try { return document.querySelector(sel); } catch (e) { throw new Error('Invalid selector: ' + sel); }
}`;
/**
 * `function(opts) -> { title, url, elements, total, truncated, scroll }`
 * Indexes visible interactive elements with fresh @refs (stale refs are cleared first so they never point at the wrong node).
 */
export const SNAPSHOT_FN = `function wraveSnapshot(opts) {
  opts = opts || {};
  const max = opts.maxElements || 80;
  const viewportOnly = !!opts.viewportOnly;
  const vh = window.innerHeight, vw = window.innerWidth;

  if (opts.dismissDialogs) {
    const dismiss = ['not now', 'close', 'dismiss', 'no thanks', 'accept cookies', 'reject all', 'decline optional cookies', 'got it'];
    for (const btn of document.querySelectorAll('[role="dialog"] button, [aria-modal="true"] button, [role="dialog"] [role="button"], [aria-modal="true"] [role="button"]')) {
      const txt = (btn.innerText || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (dismiss.includes(txt) || aria === 'close' || aria === 'dismiss') { try { btn.click(); } catch (e) {} }
    }
  }

  for (const old of document.querySelectorAll('[data-wrave-ref]')) old.removeAttribute('data-wrave-ref');

  const candidates = document.querySelectorAll('a[href], button, input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="link"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [contenteditable="true"], [onclick], [tabindex="0"]');
  const elements = [];
  let total = 0, refIdx = 1;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const inView = rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
    if (viewportOnly && !inView) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.opacity === '0') continue;
    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 80);
    const ariaLabel = el.getAttribute('aria-label') || undefined;
    const placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || undefined;
    const title = el.getAttribute('title') || undefined;
    if (!text && !placeholder && !ariaLabel && !title && tag === 'div' && el.querySelector('button, a, input, textarea')) continue;
    total++;
    if (elements.length >= max) continue;
    const ref = '@' + (refIdx++);
    el.setAttribute('data-wrave-ref', ref);
    const item = {
      ref, tag,
      role: el.getAttribute('role') || (el.isContentEditable ? 'textbox' : undefined),
      type: el.getAttribute('type') || undefined,
      text: text || undefined, ariaLabel, placeholder, title,
      name: el.getAttribute('name') || undefined,
      href: tag === 'a' ? (el.getAttribute('href') || undefined) : undefined,
      box: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
      offscreen: inView ? undefined : true,
    };
    if (tag === 'input' || tag === 'textarea') {
      if (el.type === 'checkbox' || el.type === 'radio') item.checked = el.checked;
      else if (el.value && el.type !== 'password') item.value = String(el.value).substring(0, 60);
    }
    if (tag === 'select') {
      item.value = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '';
      item.options = Array.from(el.options).slice(0, 15).map((o) => o.text.trim());
    }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true;
    if (el.getAttribute('aria-checked')) item.checked = el.getAttribute('aria-checked') === 'true';
    if (el.getAttribute('aria-expanded')) item.expanded = el.getAttribute('aria-expanded') === 'true';
    elements.push(item);
  }
  const se = document.scrollingElement || document.documentElement;
  return {
    title: document.title,
    url: location.href,
    elements,
    total,
    truncated: total > elements.length,
    scroll: { y: Math.round(se.scrollTop), height: Math.round(se.scrollHeight), viewport: vh },
  };
}`;
/**
 * `function(quietMs, maxMs) -> Promise<number>`
 * Resolves once the DOM has had no mutations for `quietMs`, or after `maxMs`. Returns elapsed ms.
 */
export const SETTLE_FN = `function wraveSettle(quietMs, maxMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    let timer;
    const done = () => { obs.disconnect(); clearTimeout(timer); clearTimeout(hard); resolve(Math.round(performance.now() - start)); };
    const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quietMs); });
    obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    timer = setTimeout(done, quietMs);
    const hard = setTimeout(done, maxMs);
  });
}`;
/**
 * `function(maxChars, sel) -> { title, url, text, truncated }`
 * Readable page text (or of one element), blank lines collapsed.
 */
export const TEXT_FN = `function wraveText(maxChars, sel) {
  const root = sel ? wraveResolve(sel) : document.body;
  if (!root) throw new Error('Element not found: ' + sel);
  let text = (root.innerText || root.textContent || '').replace(/[ \\t]+/g, ' ').replace(/\\n\\s*\\n+/g, '\\n').trim();
  const truncated = text.length > maxChars;
  if (truncated) text = text.substring(0, maxChars);
  return { title: document.title, url: location.href, text, truncated };
}`;
//# sourceMappingURL=page-scripts.js.map