document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const mcpPortInput = document.getElementById('mcpPort');
  const cdpPortInput = document.getElementById('cdpPort');
  const bearerTokenInput = document.getElementById('bearerToken');
  const gatePasswordsInput = document.getElementById('gatePasswords');
  const allowJsExecInput = document.getElementById('allowJsExec');
  const allowCookiesInput = document.getElementById('allowCookies');
  const saveGeneralBtn = document.getElementById('saveGeneralBtn');
  const saveSecurityBtn = document.getElementById('saveSecurityBtn');
  const saveMsg = document.getElementById('saveMsg');
  const sidebarStatusDot = document.getElementById('sidebarStatusDot');
  const sidebarStatusText = document.getElementById('sidebarStatusText');
  const claudeHttpCmd = document.getElementById('claudeHttpCmd');
  const mcpJsonConfig = document.getElementById('mcpJsonConfig');
  const btnListTabs = document.getElementById('btnListTabs');
  const btnCaptureScreen = document.getElementById('btnCaptureScreen');
  const btnCheckHealth = document.getElementById('btnCheckHealth');
  const consoleOutput = document.getElementById('consoleOutput');

  // 1. Sidebar Tab Switching
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      const tabId = item.getAttribute('data-tab');
      document.getElementById(`pane-${tabId}`).classList.add('active');
    });
  });

  // 2. Load stored settings
  const defaults = {
    mcpPort: 8282,
    cdpPort: 9222,
    bearerToken: '',
    gatePasswords: true,
    allowJsExec: true,
    allowCookies: true
  };

  const stored = await chrome.storage.local.get(defaults);
  mcpPortInput.value = stored.mcpPort;
  cdpPortInput.value = stored.cdpPort;
  bearerTokenInput.value = stored.bearerToken;
  gatePasswordsInput.checked = stored.gatePasswords;
  allowJsExecInput.checked = stored.allowJsExec;
  allowCookiesInput.checked = stored.allowCookies;

  const antigravityStdioConfig = document.getElementById('antigravityStdioConfig');
  const mcpSseConfig = document.getElementById('mcpSseConfig');

  function updateSnippets() {
    const port = mcpPortInput.value || 8282;
    if (mcpSseConfig) {
      mcpSseConfig.textContent = JSON.stringify({
        mcpServers: {
          wrave: {
            serverUrl: `http://127.0.0.1:${port}/mcp/sse`
          }
        }
      }, null, 2);
    }
  }
  updateSnippets();

  mcpPortInput.addEventListener('input', updateSnippets);

  // 3. Save Handlers
  saveGeneralBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      mcpPort: parseInt(mcpPortInput.value, 10) || 8282,
      cdpPort: parseInt(cdpPortInput.value, 10) || 9222,
      bearerToken: bearerTokenInput.value.trim()
    });
    saveMsg.textContent = '✓ Saved settings';
    setTimeout(() => saveMsg.textContent = '', 2000);
    checkHealth();
  });

  saveSecurityBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      gatePasswords: gatePasswordsInput.checked,
      allowJsExec: allowJsExecInput.checked,
      allowCookies: allowCookiesInput.checked
    });
    alert('Security policy saved successfully.');
  });

  // 4. Daemon Health Check
  async function checkHealth() {
    const port = parseInt(mcpPortInput.value, 10) || 8282;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET' });
      if (res.status === 200 || res.status === 404 || res.status === 405) {
        sidebarStatusDot.className = 'status-dot online';
        sidebarStatusText.textContent = `MCP Online (:${port})`;
        return true;
      }
    } catch {}
    sidebarStatusDot.className = 'status-dot';
    sidebarStatusText.textContent = `Daemon Offline (:${port})`;
    return false;
  }

  checkHealth();
  setInterval(checkHealth, 4000);

  // 5. Copy Snippet Buttons
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        navigator.clipboard.writeText(targetEl.textContent).then(() => {
          btn.textContent = '✓ Copied!';
          setTimeout(() => btn.textContent = '📋 Copy', 1500);
        });
      }
    });
  });

  // 6. Diagnostic Console Actions
  btnListTabs.addEventListener('click', async () => {
    try {
      const tabs = await chrome.tabs.query({});
      const summary = tabs.map(t => ({
        id: t.id,
        index: t.index,
        active: t.active,
        title: t.title,
        url: t.url
      }));
      consoleOutput.textContent = JSON.stringify(summary, null, 2);
    } catch (err) {
      consoleOutput.textContent = `Error listing tabs: ${err.message}`;
    }
  });

  btnCaptureScreen.addEventListener('click', async () => {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      consoleOutput.textContent = `Screenshot captured successfully!\nBase64 length: ${dataUrl.length} bytes\nData URI preview: ${dataUrl.substring(0, 80)}...`;
    } catch (err) {
      consoleOutput.textContent = `Error capturing screenshot: ${err.message}\nMake sure an active webpage tab is open.`;
    }
  });

  btnCheckHealth.addEventListener('click', async () => {
    consoleOutput.textContent = 'Pinging MCP daemon on port ' + mcpPortInput.value + '...';
    const isOnline = await checkHealth();
    if (isOnline) {
      consoleOutput.textContent = `[SUCCESS] MCP Gateway responded on port ${mcpPortInput.value}!\nReady for Claude Code / Antigravity connections.`;
    } else {
      consoleOutput.textContent = `[OFFLINE] Could not connect to http://127.0.0.1:${mcpPortInput.value}/mcp\nEnsure the MCP companion is running:\n  node src/wrave-engine/cli.js --server`;
    }
  });
});
