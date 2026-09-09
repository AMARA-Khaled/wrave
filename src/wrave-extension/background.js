// Wrave Extension Background Service Worker
// Provides WebSocket bridge between Brave Browser and Wrave MCP Companion

let bridgeSocket = null;
let reconnectTimer = null;
let isConnecting = false;

async function getSettings() {
  return await chrome.storage.local.get({
    mcpPort: 8282,
    cdpPort: 9222,
    allowJsExec: true,
    allowCookies: true,
    gatePasswords: true
  });
}

// 1. Initialize settings on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Wrave] Extension installed successfully.');
  const defaults = {
    mcpPort: 8282,
    cdpPort: 9222,
    allowJsExec: true,
    allowCookies: true,
    gatePasswords: true
  };
  await chrome.storage.local.set(defaults);
  initBridge();
});

// 2. Connect to Local MCP Companion via WebSocket Bridge
async function initBridge() {
  if (isConnecting) return;
  if (bridgeSocket && (bridgeSocket.readyState === WebSocket.OPEN || bridgeSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  isConnecting = true;

  let mcpPort = 8282;
  try {
    const settings = await getSettings();
    mcpPort = settings.mcpPort || 8282;

    // First verify daemon is online via quiet fetch to avoid net::ERR_CONNECTION_REFUSED console spam
    const probe = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: 'GET',
      signal: AbortSignal.timeout(1200)
    });
    if (!probe.ok && probe.status !== 200 && probe.status !== 404 && probe.status !== 405) {
      isConnecting = false;
      scheduleReconnect();
      return;
    }
  } catch {
    // Daemon is currently offline (normal when not running HTTP server)
    isConnecting = false;
    scheduleReconnect();
    return;
  }

  const wsUrl = `ws://127.0.0.1:${mcpPort}/extension`;

  try {
    const ws = new WebSocket(wsUrl);
    bridgeSocket = ws;

    ws.onopen = () => {
      isConnecting = false;
      console.log('[Wrave Bridge] Connected to MCP Companion on port', mcpPort);
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'register',
            client: 'brave-extension',
            version: '1.2.0'
          }));
        }
      } catch (sendErr) {
        console.warn('[Wrave Bridge] Failed to send register message:', sendErr);
      }
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        handleCompanionCommand(message);
      } catch (err) {
        console.error('[Wrave Bridge] Error parsing companion message:', err);
      }
    };

    ws.onclose = () => {
      if (bridgeSocket === ws) bridgeSocket = null;
      isConnecting = false;
      scheduleReconnect();
    };

    ws.onerror = () => {
      if (bridgeSocket === ws) bridgeSocket = null;
      isConnecting = false;
      scheduleReconnect();
    };
  } catch (err) {
    isConnecting = false;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initBridge();
  }, 10000);
}

// Keep connection alive
initBridge();

try {
  chrome.alarms.create('bridgeKeepAlive', { periodInMinutes: 0.2 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'bridgeKeepAlive') {
      initBridge();
    }
  });
} catch {}

chrome.tabs.onActivated.addListener(() => initBridge());
chrome.tabs.onUpdated.addListener(() => initBridge());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'reconnect') {
    if (bridgeSocket) {
      try { bridgeSocket.close(); } catch {}
      bridgeSocket = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    initBridge().then(() => sendResponse({ status: 'initiated' }));
    return true;
  }
});

// 3. Dispatch and execute commands from MCP Companion
async function handleCompanionCommand(cmd) {
  const { id, method, params } = cmd;
  const settings = await getSettings();

  const reply = (result, error = null) => {
    if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
      bridgeSocket.send(JSON.stringify({ id, result, error }));
    }
  };

  try {
    switch (method) {
      case 'tabs_list':
      case 'tab_list': {
        const tabs = await chrome.tabs.query({});
        const list = tabs.map(t => ({
          id: t.id,
          index: t.index,
          title: t.title,
          url: t.url,
          active: t.active,
          status: t.status
        }));
        reply(list);
        break;
      }

      case 'tab_create':
      case 'tab_open': {
        const newTab = await chrome.tabs.create({
          url: params.url || 'https://google.com',
          active: params.active !== false && params.activate !== false
        });
        await waitForTabComplete(newTab.id, 2500);
        await new Promise(r => setTimeout(r, 400));
        const snapshot = await captureTabSnapshot(newTab.id);
        reply({
          tabId: newTab.id,
          url: snapshot.url || newTab.url,
          title: snapshot.title,
          elements: snapshot.elements
        });
        break;
      }

      case 'tab_close': {
        const tabId = parseInt(params.tabId, 10);
        await chrome.tabs.remove(tabId);
        reply({ success: true, tabId });
        break;
      }

      case 'tab_activate':
      case 'tab_focus': {
        const tabId = parseInt(params.tabId, 10);
        await chrome.tabs.update(tabId, { active: true });
        reply({ success: true, tabId });
        break;
      }

      case 'page_navigate': {
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        await chrome.tabs.update(tabId, { url: params.url });
        reply({ success: true, tabId, url: params.url });
        break;
      }

      case 'page_screenshot':
      case 'tab_screenshot': {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: params.format === 'jpeg' ? 'jpeg' : 'png' });
        reply({ dataUrl, dataBase64: dataUrl ? dataUrl.replace(/^data:image\/\w+;base64,/, '') : '' });
        break;
      }

      case 'page_get_dom': {
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (asHtml) => {
            return asHtml ? document.documentElement.outerHTML : document.body.innerText;
          },
          args: [!!params.html]
        });
        const content = results && results[0] ? results[0].result : '';
        reply({ content });
        break;
      }

      case 'page_execute_js': {
        if (!settings.allowJsExec) {
          return reply(null, 'JavaScript execution is disabled in Wrave security settings.');
        }
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (scriptCode) => {
            try {
              return { success: true, result: eval(scriptCode) };
            } catch (ex) {
              return { success: false, error: ex.message };
            }
          },
          args: [params.script]
        });
        reply(results && results[0] ? results[0].result : null);
        break;
      }

      case 'tab_reload': {
        const tabId = parseInt(params.tabId, 10);
        await chrome.tabs.reload(tabId, { bypassCache: !!params.ignore_cache });
        reply({ success: true, tabId });
        break;
      }

      case 'extension_reload': {
        reply({ success: true, message: 'Reloading extension' });
        setTimeout(() => chrome.runtime.reload(), 100);
        break;
      }

      case 'tab_get_state': {
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        const tab = await chrome.tabs.get(tabId);
        reply({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          active: tab.active,
          status: tab.status,
          width: tab.width,
          height: tab.height
        });
        break;
      }

      case 'page_click': {
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel) => {
            let el = null;
            if (sel && sel.startsWith('@')) {
              el = document.querySelector(`[data-wrave-ref="${sel}"]`);
            }
            if (!el && sel && !sel.startsWith('text:')) {
              try { el = document.querySelector(sel); } catch {}
            }
            if (!el && sel) {
              const query = sel.replace(/^text:/i, '').trim().toLowerCase();
              const all = Array.from(document.querySelectorAll('div, span, p, a, button, h1, h2, h3, h4'));
              const matches = all.filter(e => e.children.length <= 2 && e.innerText && e.innerText.trim().toLowerCase().includes(query));
              if (matches.length > 0) {
                el = matches[0].closest('div[role="button"], a, div[tabindex], button') || matches[0];
              }
            }
            if (!el) return { success: false, error: 'Element not found: ' + sel };
            el.scrollIntoView({ block: 'center' });
            el.click();
            return { success: true };
          },
          args: [params.selector || params.target || '']
        });
        reply(results && results[0] ? results[0].result : { success: false });
        break;
      }

      case 'page_type_text': {
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel, text, clear) => {
            let el = null;
            if (sel && sel.startsWith('@')) {
              el = document.querySelector(`[data-wrave-ref="${sel}"]`);
            }
            if (!el && sel) {
              try { el = document.querySelector(sel); } catch {}
            }
            if (!el) {
              el = document.querySelector('div[contenteditable="true"], div[role="textbox"], textarea, input[type="text"]');
            }
            if (!el) return { success: false, error: 'Input element not found' };
            el.focus();
            if (el.isContentEditable) {
              if (clear) el.innerText = '';
              document.execCommand('insertText', false, text);
            } else {
              if (clear) el.value = '';
              el.value += text;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return { success: true, textEntered: text };
          },
          args: [params.selector || params.target || '', params.text || '', !!params.clear_first]
        });
        reply(results && results[0] ? results[0].result : { success: false });
        break;
      }

      case 'page_type_and_submit': {
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel, text, clear, submitKey) => {
            let el = null;
            if (sel && sel.startsWith('@')) {
              el = document.querySelector(`[data-wrave-ref="${sel}"]`);
            }
            if (!el && sel) {
              try { el = document.querySelector(sel); } catch {}
            }
            if (!el) {
              el = document.querySelector('div[contenteditable="true"], div[role="textbox"], textarea, input[type="text"]');
            }
            if (!el) return { success: false, error: 'Input element not found' };
            el.focus();
            if (el.isContentEditable) {
              if (clear) el.innerText = '';
              document.execCommand('insertText', false, text);
            } else {
              if (clear) el.value = '';
              el.value += text;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const keyName = submitKey || 'Enter';
            const code = keyName === 'Enter' ? 13 : 0;
            const eventInit = { key: keyName, code: keyName, keyCode: code, which: code, bubbles: true, cancelable: true };
            el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
            el.dispatchEvent(new KeyboardEvent('keypress', eventInit));
            el.dispatchEvent(new KeyboardEvent('keyup', eventInit));
            return { success: true, textEntered: text, submittedKey: keyName };
          },
          args: [params.selector || params.target || '', params.text || '', !!params.clear_first, params.submit_key || 'Enter']
        });
        reply(results && results[0] ? results[0].result : { success: false });
        break;
      }

      case 'page_click_and_read': {
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel) => {
            let el = null;
            if (sel && sel.startsWith('@')) {
              el = document.querySelector(`[data-wrave-ref="${sel}"]`);
            }
            if (!el && sel && !sel.startsWith('text:')) {
              try { el = document.querySelector(sel); } catch {}
            }
            if (!el && sel) {
              const query = sel.replace(/^text:/i, '').trim().toLowerCase();
              const all = Array.from(document.querySelectorAll('div, span, p, a, button, h1, h2, h3, h4'));
              const matches = all.filter(e => e.children.length <= 2 && e.innerText && e.innerText.trim().toLowerCase().includes(query));
              if (matches.length > 0) {
                el = matches[0].closest('div[role="button"], a, div[tabindex], button') || matches[0];
              }
            }
            if (el) {
              el.scrollIntoView({ block: 'center' });
              el.click();
            }
          },
          args: [params.selector || params.target || '']
        });
        await new Promise(r => setTimeout(r, 600));
        const snapshot = await captureTabSnapshot(tabId);
        reply(snapshot);
        break;
      }

      case 'page_get_snapshot': {
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        const snapshot = await captureTabSnapshot(tabId);
        reply(snapshot);
        break;
      }

      case 'page_press_key': {
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (keyName) => {
            const active = document.activeElement || document.body;
            const code = keyName === 'Enter' ? 13 : 0;
            const eventInit = { key: keyName, code: keyName, keyCode: code, which: code, bubbles: true, cancelable: true };
            active.dispatchEvent(new KeyboardEvent('keydown', eventInit));
            active.dispatchEvent(new KeyboardEvent('keypress', eventInit));
            active.dispatchEvent(new KeyboardEvent('keyup', eventInit));
            return { success: true, key: keyName };
          },
          args: [params.key]
        });
        reply(results && results[0] ? results[0].result : { success: false });
        break;
      }

      case 'page_scroll': {
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel, dx, dy) => {
            let el = null;
            if (sel) {
              try { el = document.querySelector(sel); } catch {}
            }
            if (!el) {
              const elements = Array.from(document.querySelectorAll('div, section, main, ul'));
              for (const e of elements) {
                const style = window.getComputedStyle(e);
                if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && e.scrollHeight > e.clientHeight) {
                  el = e;
                  break;
                }
              }
            }
            if (el) {
              el.scrollTop += (dy || 300);
              return { success: true, scrolledElement: true, scrollTop: el.scrollTop };
            }
            window.scrollBy(dx || 0, dy || 300);
            return { success: true, scrolledWindow: true };
          },
          args: [params.selector || '', params.deltaX || 0, params.deltaY || 300]
        });
        reply(results && results[0] ? results[0].result : { success: false });
        break;
      }

      case 'page_get_cookies': {
        if (!settings.allowCookies) {
          return reply(null, 'Cookie access is disabled in Wrave security settings.');
        }
        const cookies = await chrome.cookies.getAll({ url: params.url });
        reply({ cookies });
        break;
      }

      default:
        reply(null, `Unknown method: ${method}`);
        break;
    }
  } catch (err) {
    reply(null, err.message || 'Execution error');
  }
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0].id : null;
}

function waitForTabComplete(tabId, maxWaitMs = 2500) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(async () => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(await chrome.tabs.get(tabId).catch(() => null));
      }
    }, maxWaitMs);

    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(tab);
        }
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function captureTabSnapshot(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const dismissKeywords = ['not now', 'close', 'dismiss', 'cancel', 'accept cookies', 'decline optional cookies', 'got it'];
        const dialogButtons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        for (const btn of dialogButtons) {
          const txt = (btn.innerText || '').trim().toLowerCase();
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          if (dismissKeywords.includes(txt) || ['close', 'dismiss'].includes(aria)) {
            if (btn.closest('div[role="dialog"], div[aria-modal="true"], section[role="dialog"]')) {
              try { btn.click(); } catch {}
            }
          }
        }

        const candidates = Array.from(document.querySelectorAll(
          'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="tab"], [role="menuitem"], [role="checkbox"], [contenteditable="true"], [tabindex="0"]'
        ));

        let refIdx = 1;
        const elements = [];

        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

          const ref = '@' + (refIdx++);
          el.setAttribute('data-wrave-ref', ref);

          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role') || (tag === 'button' ? 'button' : tag === 'a' ? 'link' : undefined);
          const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
          const placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || undefined;
          const ariaLabel = el.getAttribute('aria-label') || undefined;
          const type = el.getAttribute('type') || undefined;
          const title = el.getAttribute('title') || undefined;

          if (!text && !placeholder && !ariaLabel && !title && tag === 'div' && el.querySelector('button, a, input, textarea')) {
            continue;
          }

          elements.push({
            ref,
            tag,
            role: role || (el.isContentEditable ? 'textbox' : undefined),
            text: text || undefined,
            placeholder,
            ariaLabel,
            type,
            title,
            box: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)]
          });

          if (elements.length >= 60) break;
        }

        return {
          title: document.title,
          url: window.location.href,
          elements
        };
      }
    });
    return results && results[0] ? results[0].result : { title: '', url: '', elements: [] };
  } catch (e) {
    return { title: '', url: '', elements: [], error: e.message };
  }
}
