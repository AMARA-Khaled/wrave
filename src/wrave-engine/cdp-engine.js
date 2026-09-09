/**
 * Wrave High-Speed CDP Automation Engine
 * Connects directly to Chromium / Brave remote debugging protocol (CDP).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let SECURITY_BANNER_SCRIPT = '';
try {
  const bannerPath = path.join(__dirname, 'security-banner-script.js');
  if (fs.existsSync(bannerPath)) {
    SECURITY_BANNER_SCRIPT = fs.readFileSync(bannerPath, 'utf-8');
  }
} catch {}

export class WraveCdpEngine {
  constructor(options = {}) {
    this.cdpHost = options.host || '127.0.0.1';
    this.cdpPort = options.port || 9222;
    this.securityMode = options.securityMode || 'ask_validation'; // 'full_access' | 'ask_validation' | 'restricted'
    this.alwaysAllowedDomains = new Set();
    this.sessions = new Map(); // targetId -> { ws, messageId, callbacks, consoleLogs }
  }

  get cdpBaseUrl() {
    return `http://${this.cdpHost}:${this.cdpPort}`;
  }

  async isCdpAvailable() {
    const now = Date.now();
    if (this._cdpCacheTime && (now - this._cdpCacheTime < 10000)) {
      return this._cdpAvailableCache;
    }
    try {
      const res = await fetch(`${this.cdpBaseUrl}/json/version`, {
        signal: AbortSignal.timeout(150),
      });
      this._cdpAvailableCache = res.ok;
    } catch {
      this._cdpAvailableCache = false;
    }
    this._cdpCacheTime = now;
    return this._cdpAvailableCache;
  }

  async getVersionInfo() {
    const res = await fetch(`${this.cdpBaseUrl}/json/version`);
    return await res.json();
  }

  // --- TAB MANAGEMENT (CRUD) ---

  async listTabs() {
    const res = await fetch(`${this.cdpBaseUrl}/json/list`);
    const targets = await res.json();
    return targets
      .filter((t) => t.type === 'page')
      .map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        active: !t.url.startsWith('chrome-extension://'),
        webSocketDebuggerUrl: t.webSocketDebuggerUrl,
      }));
  }

  async openTab(url = 'about:blank', activate = true) {
    const encodedUrl = encodeURIComponent(url);
    const res = await fetch(`${this.cdpBaseUrl}/json/new?${encodedUrl}`, {
      method: 'PUT',
    });
    const tab = await res.json();
    if (activate && tab.id) {
      await this.focusTab(tab.id);
    }
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      status: 'opened',
    };
  }

  async closeTab(tabId) {
    try {
      if (this.sessions.has(tabId)) {
        const s = this.sessions.get(tabId);
        try { s.ws.close(); } catch {}
        this.sessions.delete(tabId);
      }
      const res = await fetch(`${this.cdpBaseUrl}/json/close/${tabId}`);
      const text = await res.text();
      return { id: tabId, status: 'closed', response: text };
    } catch (err) {
      return { id: tabId, status: 'error', error: err.message };
    }
  }

  async focusTab(tabId) {
    const res = await fetch(`${this.cdpBaseUrl}/json/activate/${tabId}`);
    const text = await res.text();
    return { id: tabId, status: 'focused', response: text };
  }

  async reloadTab(tabId, ignoreCache = false) {
    await this.sendCdpCommand(tabId, 'Page.reload', { ignoreCache });
    return { id: tabId, status: 'reloaded' };
  }

  // --- CDP SESSION & PROTOCOL HANDLING ---

  async ensureSession(tabId) {
    if (this.sessions.has(tabId)) {
      const s = this.sessions.get(tabId);
      if (s.ws.readyState === WebSocket.OPEN) return s;
    }

    const tabs = await fetch(`${this.cdpBaseUrl}/json/list`).then((r) => r.json());
    const target = tabs.find((t) => t.id === tabId);
    if (!target || !target.webSocketDebuggerUrl) {
      throw new Error(`Tab ${tabId} not found or has no debugger websocket`);
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const session = {
      tabId,
      ws,
      messageId: 1,
      callbacks: new Map(),
      consoleLogs: [],
    };

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && session.callbacks.has(data.id)) {
        const { resolve, reject } = session.callbacks.get(data.id);
        session.callbacks.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      } else if (data.method === 'Runtime.consoleAPICalled') {
        session.consoleLogs.push({
          type: data.params.type,
          args: data.params.args.map((a) => a.value || a.description),
          timestamp: Date.now(),
        });
        if (session.consoleLogs.length > 200) session.consoleLogs.shift();
      }
    };

    this.sessions.set(tabId, session);

    // Enable necessary CDP domains
    await this.sendCdpCommand(tabId, 'Page.enable');
    await this.sendCdpCommand(tabId, 'Runtime.enable');
    await this.sendCdpCommand(tabId, 'DOM.enable');
    await this.sendCdpCommand(tabId, 'Accessibility.enable');

    if (SECURITY_BANNER_SCRIPT) {
      await this.sendCdpCommand(tabId, 'Page.addScriptToEvaluateOnNewDocument', {
        source: SECURITY_BANNER_SCRIPT,
      });
    }

    return session;
  }

  async sendCdpCommand(tabId, method, params = {}) {
    const session = await this.ensureSession(tabId);
    const id = session.messageId++;
    return new Promise((resolve, reject) => {
      session.callbacks.set(id, { resolve, reject });
      session.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // --- SECURITY ENFORCEMENT ---

  async validateAction(tabId, actionType, details = {}) {
    if (this.securityMode === 'full_access') return true;

    if (this.securityMode === 'restricted') {
      const blocked = ['click', 'type_text', 'execute_script'];
      if (blocked.includes(actionType)) {
        throw new Error(`Action "${actionType}" blocked under restricted security mode.`);
      }
      return true;
    }

    // 'ask_validation' mode: Intercept sensitive form submissions / passwords
    if (details.isPassword || details.isPayment) {
      throw new Error(`Action blocked: Sensitive password or payment interaction requires manual user confirmation.`);
    }

    return true;
  }

  // --- DOM & ACCESSIBILITY INSPECTION ---

  async getTabState(tabId) {
    const evalRes = await this.sendCdpCommand(tabId, 'Runtime.evaluate', {
      expression: `({
        title: document.title,
        url: location.href,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      })`,
      returnByValue: true,
    });
    return evalRes.result.value;
  }

  async getDomTree(tabId, maxDepth = 4) {
    const script = `
      (function extractTree(node, depth, max) {
        if (!node || depth > max) return null;
        if (node.nodeType === 3) {
          const text = node.textContent.trim();
          return text ? { type: 'text', text: text.substring(0, 100) } : null;
        }
        if (node.nodeType !== 1) return null;
        
        const rect = node.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        if (!isVisible && depth > 1) return null;

        const info = {
          tag: node.tagName.toLowerCase(),
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
      })(document.body, 1, ${maxDepth})
    `;
    const res = await this.sendCdpCommand(tabId, 'Runtime.evaluate', {
      expression: script,
      returnByValue: true,
    });
    return res.result.value;
  }

  async getAccessibilityTree(tabId) {
    return await this.sendCdpCommand(tabId, 'Accessibility.getFullAXTree');
  }

  // --- SCREENSHOT CAPTURE ---

  async takeScreenshot(tabId, format = 'png', quality = 80, fullPage = false) {
    let clip = undefined;
    if (fullPage) {
      const metrics = await this.sendCdpCommand(tabId, 'Page.getLayoutMetrics');
      const { width, height } = metrics.contentSize;
      clip = { x: 0, y: 0, width, height, scale: 1 };
    }
    const params = { format, fromSurface: true };
    if (format === 'jpeg') params.quality = quality;
    if (clip) params.clip = clip;

    const res = await this.sendCdpCommand(tabId, 'Page.captureScreenshot', params);
    return {
      format,
      dataBase64: res.data,
      sizeBytes: Math.round((res.data.length * 3) / 4),
    };
  }

  // --- DIRECT MOUSE & KEYBOARD INTERACTION ---

  async click(tabId, target, button = 'left', clickCount = 1) {
    let x, y;
    if (typeof target === 'object' && target.x !== undefined && target.y !== undefined) {
      x = target.x;
      y = target.y;
    } else if (typeof target === 'string') {
      const res = await this.sendCdpCommand(tabId, 'Runtime.evaluate', {
        expression: `(function() {
          const el = document.querySelector(${JSON.stringify(target)});
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, isPassword: el.type === 'password' };
        })()`,
        returnByValue: true,
      });
      if (!res.result.value) {
        throw new Error(`Element selector "${target}" not found on tab ${tabId}`);
      }
      x = Math.round(res.result.value.x);
      y = Math.round(res.result.value.y);
      await this.validateAction(tabId, 'click', { selector: target, isPassword: res.result.value.isPassword });
    } else {
      throw new Error('Invalid target: specify {x, y} coordinates or CSS selector string');
    }

    // Dispatch mouse click directly
    await this.sendCdpCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
    });
    await this.sendCdpCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      clickCount,
    });
    await new Promise((r) => setTimeout(r, 50));
    await this.sendCdpCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      clickCount,
    });

    return { tabId, x, y, status: 'clicked' };
  }

  async doubleClick(tabId, target) {
    return this.click(tabId, target, 'left', 2);
  }

  async typeText(tabId, selector, text, clearFirst = false) {
    await this.validateAction(tabId, 'type_text', { selector });

    if (selector) {
      await this.sendCdpCommand(tabId, 'Runtime.evaluate', {
        expression: `(function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          el.focus();
          if (${clearFirst}) el.value = '';
        })()`,
        returnByValue: true,
      });
    }

    for (const char of text) {
      await this.sendCdpCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char,
        unmodifiedText: char,
      });
      await this.sendCdpCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
      });
      await new Promise((r) => setTimeout(r, 10));
    }

    return { tabId, selector, textLength: text.length, status: 'typed' };
  }

  async pressKey(tabId, key) {
    await this.sendCdpCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key,
    });
    await this.sendCdpCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
    });
    return { tabId, key, status: 'pressed' };
  }

  async scrollPage(tabId, deltaX = 0, deltaY = 300) {
    await this.sendCdpCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 300,
      y: 300,
      deltaX,
      deltaY,
    });
    return { tabId, deltaX, deltaY, status: 'scrolled' };
  }

  async executeScript(tabId, expression) {
    await this.validateAction(tabId, 'execute_script', { expression });
    const res = await this.sendCdpCommand(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result.value;
  }

  async getCookies(tabId) {
    const res = await this.sendCdpCommand(tabId, 'Network.getCookies');
    return res.cookies || [];
  }

  async printToPdf(tabId) {
    const res = await this.sendCdpCommand(tabId, 'Page.printToPDF', {});
    return {
      mimeType: 'application/pdf',
      dataBase64: res.data,
    };
  }

  async getConsoleLogs(tabId) {
    if (!this.sessions.has(tabId)) return [];
    return this.sessions.get(tabId).consoleLogs;
  }
}
