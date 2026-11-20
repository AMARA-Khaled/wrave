/**
 * Wrave High-Speed CDP Automation Engine
 * Connects directly to Chromium / Brave remote debugging protocol (CDP).
 */

import WebSocket from 'ws';
import {
  CdpOptions,
  SecurityMode,
  TabInfo,
  TabState,
  ScreenshotResult,
} from './types.js';
import { RESOLVE_FN, SNAPSHOT_FN, SETTLE_FN, TEXT_FN } from './page-scripts.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type LoadPhase = 'loading' | 'interactive' | 'complete';

interface CdpSession {
  tabId: string;
  ws: WebSocket;
  messageId: number;
  callbacks: Map<number, { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }>;
  consoleLogs: Array<{ type: string; args: any[]; timestamp: number }>;
  mainFrameId: string | null;
  phase: LoadPhase;
  axEnabled: boolean;
  /** In-flight requests that usually precede a UI update (document / XHR / fetch / script). */
  inflight: Map<string, number>;
}

const TRACKED_REQUEST_TYPES = new Set(['Document', 'XHR', 'Fetch', 'Script']);

export interface SnapshotOptions {
  maxElements?: number;
  viewportOnly?: boolean;
  dismissDialogs?: boolean;
}

export interface IdleOptions {
  /** Max time to wait for an in-flight navigation to reach DOMContentLoaded. */
  loadTimeoutMs?: number;
  /** DOM must be mutation-free for this long. */
  quietMs?: number;
  /** Upper bound on the DOM-settle wait. */
  settleMaxMs?: number;
}

export interface FormField {
  selector: string;
  value: string | number | boolean;
}

/** Key definitions for Input.dispatchKeyEvent (Windows virtual key codes). */
const KEY_DEFS: Record<string, { code: string; keyCode: number; text?: string; key?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Space: { code: 'Space', keyCode: 32, text: ' ', key: ' ' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  Insert: { code: 'Insert', keyCode: 45 },
};
const KEY_ALIASES: Record<string, string> = {
  return: 'Enter', esc: 'Escape', del: 'Delete', ' ': 'Space', spacebar: 'Space',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
};
const MODIFIER_BITS: Record<string, number> = { alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

export class WraveCdpEngine {
  public cdpHost: string;
  public cdpPort: number;
  public securityMode: SecurityMode;
  public alwaysAllowedDomains: Set<string>;
  private sessions: Map<string, CdpSession>;
  private pendingSessions: Map<string, Promise<CdpSession>>;
  private _cdpAvailableCache: boolean = false;
  private _cdpCacheTime: number = 0;

  constructor(options: CdpOptions = {}) {
    this.cdpHost = options.host || '127.0.0.1';
    this.cdpPort = options.port || 9222;
    this.securityMode = options.securityMode || 'ask_validation';
    this.alwaysAllowedDomains = new Set<string>();
    this.sessions = new Map<string, CdpSession>();
    this.pendingSessions = new Map<string, Promise<CdpSession>>();
  }

  get cdpBaseUrl(): string {
    return `http://${this.cdpHost}:${this.cdpPort}`;
  }

  /**
   * Positive results are cached for 10s, negative ones for only 1s so a freshly
   * launched browser is picked up almost immediately.
   */
  async isCdpAvailable(): Promise<boolean> {
    const now = Date.now();
    const ttl = this._cdpAvailableCache ? 10000 : 1000;
    if (this._cdpCacheTime && now - this._cdpCacheTime < ttl) {
      return this._cdpAvailableCache;
    }
    try {
      const res = await fetch(`${this.cdpBaseUrl}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      this._cdpAvailableCache = res.ok;
    } catch {
      this._cdpAvailableCache = false;
    }
    this._cdpCacheTime = Date.now();
    return this._cdpAvailableCache;
  }

  invalidateAvailability(): void {
    this._cdpCacheTime = 0;
  }

  async getVersionInfo(): Promise<any> {
    const res = await fetch(`${this.cdpBaseUrl}/json/version`);
    return await res.json();
  }

  // --- TAB MANAGEMENT (CRUD) ---

  async listTabs(): Promise<TabInfo[]> {
    const res = await fetch(`${this.cdpBaseUrl}/json/list`);
    const targets = (await res.json()) as any[];
    return targets
      .filter((t) => t.type === 'page' && !/^(chrome|brave)-extension:|^devtools:/.test(t.url))
      .map((t) => ({ id: t.id, title: t.title, url: t.url }));
  }

  async openTab(url = 'about:blank', activate = true, wait = true): Promise<{ id: string; url: string; title: string; status: string }> {
    const res = await fetch(`${this.cdpBaseUrl}/json/new?${encodeURIComponent(normalizeUrl(url))}`, { method: 'PUT' });
    const tab = (await res.json()) as any;
    if (activate && tab.id) {
      await this.focusTab(tab.id);
    }
    if (wait && tab.id && url !== 'about:blank') {
      await this.waitForReadyState(tab.id, 15000, true);
      await this.settle(tab.id, 200, 1500);
    }
    return { id: tab.id, url: tab.url, title: tab.title, status: 'opened' };
  }

  async closeTab(tabId: string): Promise<any> {
    try {
      this.dropSession(tabId);
      const res = await fetch(`${this.cdpBaseUrl}/json/close/${tabId}`);
      const text = await res.text();
      return { id: tabId, status: 'closed', response: text };
    } catch (err: any) {
      return { id: tabId, status: 'error', error: err.message };
    }
  }

  async focusTab(tabId: string): Promise<any> {
    const res = await fetch(`${this.cdpBaseUrl}/json/activate/${tabId}`);
    const text = await res.text();
    return { id: tabId, status: 'focused', response: text };
  }

  async reloadTab(tabId: string, ignoreCache = false): Promise<any> {
    await this.sendCdpCommand(tabId, 'Page.reload', { ignoreCache });
    await this.waitForIdle(tabId);
    return { id: tabId, status: 'reloaded' };
  }

  // --- CDP SESSION & PROTOCOL HANDLING ---

  async ensureSession(tabId: string): Promise<CdpSession> {
    const existing = this.sessions.get(tabId);
    if (existing && existing.ws.readyState === WebSocket.OPEN) return existing;

    // De-duplicate concurrent attach attempts for the same tab.
    const pending = this.pendingSessions.get(tabId);
    if (pending) return pending;

    const attach = this.createSession(tabId).finally(() => this.pendingSessions.delete(tabId));
    this.pendingSessions.set(tabId, attach);
    return attach;
  }

  private async createSession(tabId: string): Promise<CdpSession> {
    const tabs = (await fetch(`${this.cdpBaseUrl}/json/list`).then((r) => r.json())) as any[];
    const target = tabs.find((t) => t.id === tabId);
    if (!target || !target.webSocketDebuggerUrl) {
      throw new Error(`Tab ${tabId} not found or has no debugger websocket (another DevTools client may be attached). Call wrave_list_tabs for valid IDs.`);
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    const session: CdpSession = {
      tabId,
      ws,
      messageId: 1,
      callbacks: new Map(),
      consoleLogs: [],
      mainFrameId: null,
      phase: 'complete',
      axEnabled: false,
      inflight: new Map(),
    };

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    ws.on('message', (dataStr: any) => {
      let data: any;
      try { data = JSON.parse(dataStr.toString()); } catch { return; }
      if (data.id !== undefined) {
        const cb = session.callbacks.get(data.id);
        if (!cb) return;
        session.callbacks.delete(data.id);
        clearTimeout(cb.timer);
        if (data.error) cb.reject(new Error(data.error.message));
        else cb.resolve(data.result);
        return;
      }
      this.handleEvent(session, data.method, data.params || {});
    });

    const teardown = () => {
      for (const cb of session.callbacks.values()) {
        clearTimeout(cb.timer);
        cb.reject(new Error(`Connection to tab ${tabId} closed (tab closed or browser exited).`));
      }
      session.callbacks.clear();
      if (this.sessions.get(tabId) === session) this.sessions.delete(tabId);
    };
    ws.on('close', teardown);
    ws.on('error', teardown);

    this.sessions.set(tabId, session);

    // Enable domains in parallel (one round trip instead of four sequential ones).
    const setup: Promise<any>[] = [
      this.rawSend(session, 'Page.enable'),
      this.rawSend(session, 'Runtime.enable'),
      this.rawSend(session, 'Network.enable').catch(() => {}),
      this.rawSend(session, 'Page.getFrameTree').then((tree) => {
        session.mainFrameId = tree?.frameTree?.frame?.id || null;
      }),
    ];
    await Promise.all(setup);

    return session;
  }

  private handleEvent(session: CdpSession, method: string, params: any): void {
    switch (method) {
      case 'Runtime.consoleAPICalled':
        session.consoleLogs.push({
          type: params.type,
          args: (params.args || []).map((a: any) => a.value ?? a.description),
          timestamp: Date.now(),
        });
        if (session.consoleLogs.length > 200) session.consoleLogs.shift();
        break;
      case 'Runtime.exceptionThrown':
        session.consoleLogs.push({
          type: 'exception',
          args: [params.exceptionDetails?.exception?.description || params.exceptionDetails?.text],
          timestamp: Date.now(),
        });
        if (session.consoleLogs.length > 200) session.consoleLogs.shift();
        break;
      case 'Page.frameStartedLoading':
        if (!session.mainFrameId || params.frameId === session.mainFrameId) session.phase = 'loading';
        break;
      case 'Page.domContentEventFired':
        if (session.phase === 'loading') session.phase = 'interactive';
        break;
      case 'Page.frameStoppedLoading':
        if (!session.mainFrameId || params.frameId === session.mainFrameId) session.phase = 'complete';
        break;
      case 'Network.requestWillBeSent':
        if (TRACKED_REQUEST_TYPES.has(params.type)) session.inflight.set(params.requestId, Date.now());
        break;
      case 'Network.loadingFinished':
      case 'Network.loadingFailed':
        session.inflight.delete(params.requestId);
        break;
      case 'Page.frameNavigated':
        if (!params.frame?.parentId) session.mainFrameId = params.frame.id;
        break;
    }
  }

  private rawSend(session: CdpSession, method: string, params: Record<string, any> = {}, timeoutMs = 20000): Promise<any> {
    const id = session.messageId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.callbacks.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms (page may be frozen by a dialog or heavy script).`));
      }, timeoutMs);
      session.callbacks.set(id, { resolve, reject, timer });
      try {
        session.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        session.callbacks.delete(id);
        reject(err);
      }
    });
  }

  async sendCdpCommand(tabId: string, method: string, params: Record<string, any> = {}, timeoutMs = 20000): Promise<any> {
    const session = await this.ensureSession(tabId);
    return this.rawSend(session, method, params, timeoutMs);
  }

  hasLiveSession(tabId: string): boolean {
    const s = this.sessions.get(tabId);
    return !!s && s.ws.readyState === WebSocket.OPEN;
  }

  private dropSession(tabId: string): void {
    const s = this.sessions.get(tabId);
    if (s) {
      try { s.ws.close(); } catch {}
      this.sessions.delete(tabId);
    }
  }

  /** Runtime.evaluate returning the value by value; page exceptions become thrown errors. */
  async evaluate(tabId: string, expression: string, awaitPromise = false, timeoutMs = 20000): Promise<any> {
    const res = await this.sendCdpCommand(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    }, timeoutMs);
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      const msg = d.exception?.description || d.exception?.value || d.text || 'Script error';
      throw new Error(String(msg).split('\n')[0]);
    }
    return res.result?.value;
  }

  // --- WAITING ---

  /** Polls document.readyState (works for tabs whose load started before we attached). */
  async waitForReadyState(tabId: string, timeoutMs = 15000, skipInitialBlank = false): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const [state, href] = await this.evaluate(tabId, '[document.readyState, location.href]', false, 2000);
        if ((state === 'interactive' || state === 'complete') && !(skipInitialBlank && href === 'about:blank')) return true;
      } catch {}
      await sleep(50);
    }
    return false;
  }

  /** Resolves after the DOM has been quiet for quietMs (capped at maxMs). Survives navigations. */
  async settle(tabId: string, quietMs = 200, maxMs = 2000): Promise<void> {
    try {
      await this.evaluate(tabId, `(${SETTLE_FN})(${quietMs}, ${maxMs})`, true, maxMs + 3000);
    } catch {
      // Execution context destroyed by a navigation: wait for the new document instead.
      await this.waitForReadyState(tabId, 10000);
    }
  }

  /**
   * Wait for the page to become usable after an action: any navigation the action triggered
   * reaches DOMContentLoaded, then the DOM stops changing. Replaces fixed sleeps.
   */
  /** Count of tracked requests in flight, ignoring long-lived ones (>10s: streaming / long-polling). */
  private pendingRequests(session: CdpSession): number {
    const cutoff = Date.now() - 10000;
    let n = 0;
    for (const [id, t] of session.inflight) {
      if (t < cutoff) session.inflight.delete(id);
      else n++;
    }
    return n;
  }

  async waitForIdle(tabId: string, opts: IdleOptions = {}): Promise<{ waitedMs: number; stillLoading?: boolean }> {
    const start = Date.now();
    const { loadTimeoutMs = 15000, quietMs = 200, settleMaxMs = 2000 } = opts;
    const session = await this.ensureSession(tabId);
    await sleep(40); // let click handlers kick off navigations / requests
    const deadline = Date.now() + loadTimeoutMs;
    while (session.phase === 'loading' && Date.now() < deadline) await sleep(25);
    const stillLoading = session.phase === 'loading';
    if (!stillLoading) {
      const settleDeadline = Date.now() + settleMaxMs;
      await this.settle(tabId, quietMs, settleMaxMs);
      // If requests are still in flight (XHR/fetch feeding the UI), wait for them, then let the DOM settle again.
      if (this.pendingRequests(session) > 0) {
        while (this.pendingRequests(session) > 0 && Date.now() < settleDeadline) await sleep(25);
        await this.settle(tabId, 150, Math.max(300, settleDeadline - Date.now()));
      }
    }
    return { waitedMs: Date.now() - start, ...(stillLoading ? { stillLoading: true } : {}) };
  }

  async waitFor(tabId: string, opts: { selector?: string; text?: string; gone?: boolean; timeoutMs?: number }): Promise<any> {
    const { selector, text, gone = false, timeoutMs = 10000 } = opts;
    if (!selector && !text) {
      return { status: 'idle', ...(await this.waitForIdle(tabId)) };
    }
    const start = Date.now();
    const deadline = start + timeoutMs;
    const check = `(function(){
      ${RESOLVE_FN}
      const sel = ${JSON.stringify(selector || '')};
      const txt = ${JSON.stringify((text || '').toLowerCase())};
      const want = ${!gone};
      const test = () => {
        let ok = true;
        if (sel) { const el = wraveResolve(sel); ok = !!el && (el.getClientRects().length > 0); }
        if (ok && txt) ok = (document.body ? document.body.innerText.toLowerCase() : '').includes(txt);
        return ok === want;
      };
      return new Promise((resolve) => {
        if (test()) return resolve(true);
        const end = performance.now() + __REMAINING__;
        const iv = setInterval(() => {
          if (test()) { clearInterval(iv); resolve(true); }
          else if (performance.now() > end) { clearInterval(iv); resolve(false); }
        }, 50);
      });
    })()`;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      try {
        const ok = await this.evaluate(tabId, check.replace('__REMAINING__', String(remaining)), true, remaining + 3000);
        if (ok) return { status: gone ? 'gone' : 'found', selector, text, elapsedMs: Date.now() - start };
      } catch (err: any) {
        if (/Invalid selector/.test(err.message)) throw err;
        await sleep(100); // navigation in progress; retry on the new document
      }
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${selector ? `selector "${selector}"` : ''}${selector && text ? ' and ' : ''}${text ? `text "${text}"` : ''} to ${gone ? 'disappear' : 'appear'}.`);
  }

  // --- NAVIGATION ---

  async navigate(tabId: string, url: string, timeoutMs = 15000): Promise<any> {
    const target = normalizeUrl(url);
    const res = await this.sendCdpCommand(tabId, 'Page.navigate', { url: target }, timeoutMs + 5000);
    if (res.errorText) throw new Error(`Navigation to ${target} failed: ${res.errorText}`);
    const idle = await this.waitForIdle(tabId, { loadTimeoutMs: timeoutMs });
    return { status: 'navigated', url: target, ...idle };
  }

  async goHistory(tabId: string, delta: -1 | 1, timeoutMs = 15000): Promise<any> {
    const hist = await this.sendCdpCommand(tabId, 'Page.getNavigationHistory');
    const entry = hist.entries[hist.currentIndex + delta];
    if (!entry) throw new Error(`No ${delta < 0 ? 'previous' : 'next'} page in this tab's history.`);
    await this.sendCdpCommand(tabId, 'Page.navigateToHistoryEntry', { entryId: entry.id });
    const idle = await this.waitForIdle(tabId, { loadTimeoutMs: timeoutMs });
    return { status: delta < 0 ? 'went_back' : 'went_forward', url: entry.url, ...idle };
  }

  // --- SECURITY ENFORCEMENT ---

  async validateAction(tabId: string, actionType: string, details: Record<string, any> = {}): Promise<boolean> {
    if (this.securityMode === 'full_access') return true;

    if (this.securityMode === 'restricted') {
      const blocked = ['click', 'type_text', 'execute_script'];
      if (blocked.includes(actionType)) {
        throw new Error(`Action "${actionType}" blocked under restricted security mode.`);
      }
      return true;
    }

    if (details.isPassword || details.isPayment) {
      throw new Error(`Action blocked: Sensitive password or payment interaction requires manual user confirmation.`);
    }

    return true;
  }

  // --- DOM & ACCESSIBILITY INSPECTION ---

  async getTabState(tabId: string): Promise<TabState> {
    return await this.evaluate(tabId, `({
      title: document.title,
      url: location.href,
      readyState: document.readyState,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight
    })`);
  }

  async getDomTree(tabId: string, maxDepth = 4): Promise<any> {
    const script = `
      (function extractTree(node, depth, max) {
        if (!node || depth > max) return null;
        if (node.nodeType === 3) {
          const text = node.textContent.trim();
          return text ? { type: 'text', text: text.substring(0, 100) } : null;
        }
        if (node.nodeType !== 1) return null;
        const tagName = node.tagName.toLowerCase();
        if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') return null;

        const rect = node.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        if (!isVisible && depth > 1) return null;

        const info = {
          tag: tagName,
          id: node.id || undefined,
          class: node.className && typeof node.className === 'string' ? node.className.substring(0, 60) : undefined,
          box: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        };

        if (['a', 'button', 'input', 'select', 'textarea'].includes(info.tag)) {
          info.interactive = true;
          if (node.href) info.href = node.href;
          if (node.value) info.value = node.value;
          if (node.innerText) info.text = node.innerText.trim().substring(0, 80);
        }

        const children = [];
        for (let child of node.childNodes) {
          const c = extractTree(child, depth + 1, max);
          if (c) children.push(c);
        }
        if (children.length > 0) info.children = children;
        return info;
      })(document.body, 1, ${Number(maxDepth) || 4})
    `;
    return await this.evaluate(tabId, script);
  }

  /** Compact accessibility outline: one line per meaningful node, indented by depth. */
  async getAccessibilityTree(tabId: string, maxNodes = 400): Promise<string> {
    const session = await this.ensureSession(tabId);
    if (!session.axEnabled) {
      await this.rawSend(session, 'Accessibility.enable');
      session.axEnabled = true;
    }
    const { nodes } = await this.rawSend(session, 'Accessibility.getFullAXTree');
    const byId = new Map<string, any>();
    for (const n of nodes) byId.set(n.nodeId, n);
    const skipRoles = new Set(['generic', 'none', 'InlineTextBox', 'LineBreak', 'StaticText', 'paragraph', 'group']);
    const lines: string[] = [];
    const visit = (n: any, depth: number) => {
      if (!n || lines.length >= maxNodes) return;
      const role = n.role?.value;
      const name = (n.name?.value || '').toString().trim().replace(/\s+/g, ' ').slice(0, 100);
      const value = n.value?.value;
      const meaningful = !n.ignored && role && !skipRoles.has(role);
      let nextDepth = depth;
      if (meaningful) {
        lines.push(`${'  '.repeat(depth)}${role}${name ? ` "${name}"` : ''}${value !== undefined && value !== '' ? ` = ${JSON.stringify(value)}` : ''}`);
        nextDepth = depth + 1;
      }
      for (const cid of n.childIds || []) visit(byId.get(cid), nextDepth);
    };
    visit(nodes[0], 0);
    if (lines.length >= maxNodes) lines.push(`... (truncated at ${maxNodes} nodes)`);
    return lines.join('\n');
  }

  // --- SCREENSHOT CAPTURE ---

  async takeScreenshot(tabId: string, format = 'png', quality = 80, fullPage = false): Promise<ScreenshotResult> {
    const params: any = { format, fromSurface: true };
    if (fullPage) {
      const metrics = await this.sendCdpCommand(tabId, 'Page.getLayoutMetrics');
      const { width, height } = metrics.cssContentSize || metrics.contentSize;
      params.clip = { x: 0, y: 0, width, height, scale: 1 };
      params.captureBeyondViewport = true;
    }
    if (format === 'jpeg') params.quality = quality;

    const res = await this.sendCdpCommand(tabId, 'Page.captureScreenshot', params, 30000);
    return {
      format,
      dataBase64: res.data,
      mimeType: `image/${format}`,
    };
  }

  // --- DIRECT MOUSE & KEYBOARD INTERACTION ---

  /** Resolve a selector / @ref / text: target, scroll it into view, and return its center point. */
  private async locate(tabId: string, selector: string): Promise<{ x: number; y: number; isPassword: boolean; tag: string; type: string; checked: boolean | null }> {
    const info = await this.evaluate(tabId, `(function() {
      ${RESOLVE_FN}
      const el = wraveResolve(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
      return {
        x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height,
        tag: el.tagName.toLowerCase(), type,
        checked: (type === 'checkbox' || type === 'radio') ? el.checked : null,
        isPassword: type === 'password' || auto.includes('password'),
      };
    })()`);
    if (!info) {
      throw new Error(`Element "${selector}" not found. Refs (@N) expire on every snapshot; take a fresh wrave_get_snapshot or use a CSS selector / text:Label.`);
    }
    if (!info.w || !info.h) throw new Error(`Element "${selector}" exists but is not visible (zero size).`);
    return { x: Math.round(info.x), y: Math.round(info.y), isPassword: info.isPassword, tag: info.tag, type: info.type, checked: info.checked };
  }

  async click(tabId: string, target: string | { x: number; y: number }, button = 'left', clickCount = 1): Promise<any> {
    let x: number, y: number;
    if (typeof target === 'object' && target && target.x !== undefined && target.y !== undefined) {
      x = target.x;
      y = target.y;
    } else if (typeof target === 'string' && target) {
      const loc = await this.locate(tabId, target);
      await this.validateAction(tabId, 'click', { selector: target, isPassword: loc.isPassword });
      x = loc.x;
      y = loc.y;
    } else {
      throw new Error('Invalid target: specify {x, y} coordinates or a selector (CSS, @ref, or text:Label)');
    }

    // Pipeline all mouse events: CDP processes them in order, so no need to wait between them.
    const session = await this.ensureSession(tabId);
    const events: Promise<any>[] = [this.rawSend(session, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })];
    for (let i = 1; i <= clickCount; i++) {
      events.push(this.rawSend(session, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: i }));
      events.push(this.rawSend(session, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: i }));
    }
    await Promise.all(events);

    return { x, y, status: clickCount === 2 ? 'double_clicked' : 'clicked' };
  }

  async doubleClick(tabId: string, target: string | { x: number; y: number }): Promise<any> {
    return this.click(tabId, target, 'left', 2);
  }

  async hover(tabId: string, target: string | { x: number; y: number }): Promise<any> {
    const point = typeof target === 'string' ? await this.locate(tabId, target) : target;
    await this.sendCdpCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    return { x: point.x, y: point.y, status: 'hovered' };
  }

  /**
   * Types text in a single Input.insertText call (fires real beforeinput/input events,
   * works with React/Vue/contenteditable). Previously ~22ms per character, now constant time.
   */
  async typeText(tabId: string, selector: string | undefined, text: string, clearFirst = false): Promise<any> {
    if (selector) {
      const info = await this.evaluate(tabId, `(function() {
        ${RESOLVE_FN}
        const el = wraveResolve(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.focus();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
        if (${!!clearFirst}) {
          if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && typeof el.select === 'function') el.select();
          else if (el.isContentEditable) {
            const r = document.createRange(); r.selectNodeContents(el);
            const s = getSelection(); s.removeAllRanges(); s.addRange(r);
          }
        }
        return { isPassword: type === 'password' || auto.includes('password'), focused: document.activeElement === el || el.contains(document.activeElement) };
      })()`);
      if (!info) {
        throw new Error(`Input "${selector}" not found. Take a fresh wrave_get_snapshot for current @refs.`);
      }
      await this.validateAction(tabId, 'type_text', { selector, isPassword: info.isPassword });
      if (!info.focused) {
        // Some widgets only take focus from a real click.
        await this.click(tabId, selector);
      }
    } else {
      await this.validateAction(tabId, 'type_text', {});
    }

    if (text) {
      await this.sendCdpCommand(tabId, 'Input.insertText', { text });
    } else if (clearFirst) {
      await this.pressKey(tabId, 'Delete');
    }

    return { selector, textLength: text.length, status: 'typed' };
  }

  async typeAndSubmit(tabId: string, selector: string, text: string, clearFirst = false, submitKey = 'Enter'): Promise<any> {
    await this.typeText(tabId, selector, text, clearFirst);
    await this.pressKey(tabId, submitKey);
    const idle = await this.waitForIdle(tabId);
    return { selector, textEntered: text, submittedKey: submitKey, status: 'typed_and_submitted', ...idle };
  }

  async clickAndRead(tabId: string, target: string | { x: number; y: number }, snapOpts: SnapshotOptions = {}): Promise<any> {
    await this.click(tabId, target);
    await this.waitForIdle(tabId);
    return await this.getSnapshot(tabId, snapOpts);
  }

  async getSnapshot(tabId: string, opts: SnapshotOptions = {}): Promise<any> {
    const options = {
      maxElements: opts.maxElements || 80,
      viewportOnly: !!opts.viewportOnly,
      dismissDialogs: opts.dismissDialogs !== false,
    };
    return await this.evaluate(tabId, `(${SNAPSHOT_FN})(${JSON.stringify(options)})`);
  }

  async getText(tabId: string, selector?: string, maxChars = 8000): Promise<any> {
    return await this.evaluate(tabId, `(function(){ ${RESOLVE_FN}; return (${TEXT_FN})(${Number(maxChars) || 8000}, ${JSON.stringify(selector || '')}); })()`);
  }

  async selectOption(tabId: string, selector: string, value: string): Promise<any> {
    const res = await this.evaluate(tabId, `(function() {
      ${RESOLVE_FN}
      const el = wraveResolve(${JSON.stringify(selector)});
      if (!el) return { error: 'Element not found: ' + ${JSON.stringify(selector)} };
      if (el.tagName !== 'SELECT') return { error: 'Element is a <' + el.tagName.toLowerCase() + '>, not a <select>. Click it to open custom dropdowns.' };
      const want = ${JSON.stringify(String(value))};
      const opts = Array.from(el.options);
      const lc = want.toLowerCase();
      const opt = opts.find(o => o.value === want) || opts.find(o => o.text.trim() === want)
        || opts.find(o => o.text.trim().toLowerCase() === lc) || opts.find(o => o.text.toLowerCase().includes(lc));
      if (!opt) return { error: 'No option matching "' + want + '". Options: ' + opts.map(o => o.text.trim()).join(' | ') };
      el.value = opt.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { selected: opt.text.trim(), value: opt.value };
    })()`);
    if (res.error) throw new Error(res.error);
    return { selector, ...res, status: 'selected' };
  }

  /** Fill many fields in one call. Text inputs are replaced, selects matched by value/label, checkboxes set to the given boolean. */
  async fillForm(tabId: string, fields: FormField[], submit?: string): Promise<any> {
    if (!Array.isArray(fields) || fields.length === 0) throw new Error('fields must be a non-empty array of {selector, value}');
    const results: any[] = [];
    for (const f of fields) {
      const loc = await this.locate(tabId, f.selector);
      if (loc.tag === 'select') {
        const r = await this.selectOption(tabId, f.selector, String(f.value));
        results.push({ selector: f.selector, selected: r.selected });
      } else if (loc.type === 'checkbox' || loc.type === 'radio') {
        const want = f.value === true || f.value === 'true' || f.value === 1 || f.value === 'on';
        if (loc.checked !== want) await this.click(tabId, f.selector);
        results.push({ selector: f.selector, checked: want });
      } else {
        await this.typeText(tabId, f.selector, String(f.value ?? ''), true);
        results.push({ selector: f.selector, typed: String(f.value ?? '').length });
      }
    }
    if (submit) {
      await this.click(tabId, submit);
      await this.waitForIdle(tabId);
    }
    return { status: 'filled', fields: results, ...(submit ? { submitted: submit } : {}) };
  }

  /**
   * Press a key or combination: "Enter", "Tab", "ArrowDown", "a", "Control+a", "Shift+Tab", "Meta+Enter".
   */
  async pressKey(tabId: string, combo: string): Promise<any> {
    if (!combo) throw new Error('key is required');
    const parts = combo.length > 1 ? combo.split(/\+(?!$)/) : [combo];
    let keyName = parts.pop()!;
    let modifiers = 0;
    for (const m of parts) {
      const bit = MODIFIER_BITS[m.trim().toLowerCase()];
      if (bit === undefined) throw new Error(`Unknown modifier "${m}" in "${combo}". Use Control, Shift, Alt, Meta.`);
      modifiers |= bit;
    }
    keyName = KEY_ALIASES[keyName.toLowerCase()] || keyName;
    const canonical = Object.keys(KEY_DEFS).find((k) => k.toLowerCase() === keyName.toLowerCase());

    let key: string, code: string, keyCode: number, text: string | undefined;
    if (canonical) {
      const def = KEY_DEFS[canonical];
      key = def.key || canonical;
      code = def.code;
      keyCode = def.keyCode;
      text = def.text;
    } else if (keyName.length === 1) {
      key = keyName;
      const upper = keyName.toUpperCase();
      code = /[a-z]/i.test(keyName) ? `Key${upper}` : /[0-9]/.test(keyName) ? `Digit${keyName}` : '';
      keyCode = upper.charCodeAt(0);
      text = keyName;
    } else if (/^F([1-9]|1[0-2])$/i.test(keyName)) {
      key = keyName.toUpperCase();
      code = key;
      keyCode = 111 + parseInt(key.slice(1), 10);
    } else {
      throw new Error(`Unknown key "${keyName}". Examples: Enter, Tab, Escape, Backspace, ArrowDown, PageDown, a, Control+a.`);
    }
    // Ctrl/Alt/Meta combos must not insert text (Shift is fine).
    if (modifiers & (1 | 2 | 4)) text = undefined;

    const session = await this.ensureSession(tabId);
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
    await Promise.all([
      this.rawSend(session, 'Input.dispatchKeyEvent', { ...base, type: text ? 'keyDown' : 'rawKeyDown', ...(text ? { text, unmodifiedText: text } : {}) }),
      this.rawSend(session, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' }),
    ]);
    return { key: combo, status: 'pressed' };
  }

  async scrollPage(tabId: string, opts: { deltaX?: number; deltaY?: number; selector?: string; to?: 'top' | 'bottom' } = {}): Promise<any> {
    if (opts.selector) {
      await this.locate(tabId, opts.selector);
    } else if (opts.to) {
      await this.evaluate(tabId, `window.scrollTo({ top: ${opts.to === 'top' ? 0 : 'document.documentElement.scrollHeight'}, behavior: 'instant' })`);
    } else {
      const vp = await this.evaluate(tabId, '[innerWidth, innerHeight]');
      await this.sendCdpCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: Math.round(vp[0] / 2),
        y: Math.round(vp[1] / 2),
        deltaX: opts.deltaX || 0,
        deltaY: opts.deltaY ?? 600,
      });
      await sleep(120); // wheel scrolling is applied asynchronously
    }
    const pos = await this.evaluate(tabId, `(function(){ const s = document.scrollingElement || document.documentElement; return { scrollY: Math.round(s.scrollTop), scrollHeight: s.scrollHeight, viewport: innerHeight }; })()`);
    return { status: 'scrolled', ...pos };
  }

  async executeScript(tabId: string, expression: string): Promise<any> {
    await this.validateAction(tabId, 'execute_script', { expression });
    const res = await this.sendCdpCommand(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      replMode: true, // allows top-level await and re-declaring let/const across calls
    }, 30000);
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(d.exception?.description || d.text || 'Script threw an exception');
    }
    return res.result?.value;
  }

  async getCookies(tabId: string): Promise<any> {
    const res = await this.sendCdpCommand(tabId, 'Network.getCookies');
    return res.cookies || [];
  }

  async printToPdf(tabId: string): Promise<any> {
    const res = await this.sendCdpCommand(tabId, 'Page.printToPDF', {}, 60000);
    return {
      mimeType: 'application/pdf',
      dataBase64: res.data,
    };
  }

  async getConsoleLogs(tabId: string, clear = false): Promise<any[]> {
    const s = this.sessions.get(tabId);
    if (!s) return [];
    const logs = s.consoleLogs.slice();
    if (clear) s.consoleLogs.length = 0;
    return logs;
  }
}

/** Accepts "example.com" or "localhost:3000/x" and adds a scheme. */
export function normalizeUrl(url: string): string {
  const u = (url || '').trim();
  if (!u) return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) || /^(about|data|javascript|file|blob|mailto|chrome|brave):/i.test(u)) return u;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(u)) return `http://${u}`;
  return `https://${u}`;
}
