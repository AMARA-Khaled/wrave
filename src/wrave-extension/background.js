// Wrave Extension Background Service Worker
// Provides WebSocket bridge between Brave Browser and Wrave MCP Companion

let bridgeSocket = null;
let reconnectTimer = null;

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
  if (bridgeSocket && (bridgeSocket.readyState === WebSocket.OPEN || bridgeSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const { mcpPort } = await getSettings();

  // First verify daemon is online via quiet fetch to avoid net::ERR_CONNECTION_REFUSED console spam
  try {
    const probe = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: 'GET',
      signal: AbortSignal.timeout(1200)
    });
    if (!probe.ok && probe.status !== 200 && probe.status !== 404 && probe.status !== 405) {
      scheduleReconnect();
      return;
    }
  } catch {
    // Daemon is currently offline (normal when not running HTTP server)
    scheduleReconnect();
    return;
  }

  const wsUrl = `ws://127.0.0.1:${mcpPort}/extension`;

  try {
    bridgeSocket = new WebSocket(wsUrl);

    bridgeSocket.onopen = () => {
      console.log('[Wrave Bridge] Connected to MCP Companion on port', mcpPort);
      bridgeSocket.send(JSON.stringify({
        type: 'register',
        client: 'brave-extension',
        version: '1.1.0'
      }));
    };

    bridgeSocket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        handleCompanionCommand(message);
      } catch (err) {
        console.error('[Wrave Bridge] Error parsing companion message:', err);
      }
    };

    bridgeSocket.onclose = () => {
      bridgeSocket = null;
      scheduleReconnect();
    };

    bridgeSocket.onerror = () => {
      bridgeSocket = null;
      scheduleReconnect();
    };
  } catch (err) {
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
      case 'tabs_list': {
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

      case 'tab_create': {
        const newTab = await chrome.tabs.create({
          url: params.url || 'https://google.com',
          active: params.active !== false
        });
        reply({ tabId: newTab.id, url: newTab.url });
        break;
      }

      case 'tab_close': {
        const tabId = parseInt(params.tabId, 10);
        await chrome.tabs.remove(tabId);
        reply({ success: true, tabId });
        break;
      }

      case 'tab_activate': {
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

      case 'page_screenshot': {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        reply({ dataUrl });
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
            const el = document.querySelector(sel);
            if (!el) return { success: false, error: 'Element not found: ' + sel };
            el.scrollIntoView({ block: 'center' });
            el.click();
            return { success: true };
          },
          args: [params.selector]
        });
        reply(results && results[0] ? results[0].result : { success: false });
        break;
      }

      case 'page_type_text': {
        const tabId = params.tabId ? parseInt(params.tabId, 10) : (await getActiveTabId());
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel, text, clear) => {
            const el = document.querySelector(sel);
            if (!el) return { success: false, error: 'Element not found: ' + sel };
            el.focus();
            if (clear) el.value = '';
            el.value += text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, value: el.value };
          },
          args: [params.selector, params.text, params.clear_first]
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
