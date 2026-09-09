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
  }, 5000);
}

// Keep connection alive
initBridge();

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
