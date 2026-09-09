document.addEventListener('DOMContentLoaded', async () => {
  const activeTabTitle = document.getElementById('activeTabTitle');
  const activeTabUrl = document.getElementById('activeTabUrl');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const copyBtn = document.getElementById('copyBtn');
  const mcpCode = document.getElementById('mcpCode');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const mcpPortVal = document.getElementById('mcpPortVal');
  const cdpPortVal = document.getElementById('cdpPortVal');
  const bridgeVal = document.getElementById('bridgeVal');

  // 1. Get active tab
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      activeTabTitle.textContent = tabs[0].title || 'Untitled Tab';
      activeTabUrl.textContent = tabs[0].url || 'about:blank';
    }
  } catch (err) {
    activeTabTitle.textContent = 'Active Tab';
    activeTabUrl.textContent = 'Ready';
  }

  // 2. Load stored settings (or defaults)
  let mcpPort = 8282;
  let cdpPort = 9222;
  try {
    const data = await chrome.storage.local.get(['mcpPort', 'cdpPort']);
    if (data.mcpPort) mcpPort = data.mcpPort;
    if (data.cdpPort) cdpPort = data.cdpPort;
  } catch {}

  mcpPortVal.textContent = `:${mcpPort}`;
  cdpPortVal.textContent = `:${cdpPort}`;
  mcpCode.textContent = `claude mcp add wrave -- http://127.0.0.1:${mcpPort}/mcp/sse`;

  // 3. Check live status
  async function checkStatus() {
    let mcpOnline = false;
    let cdpOnline = false;

    try {
      const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, { method: 'GET' });
      if (res.status === 200 || res.status === 404 || res.status === 405) {
        mcpOnline = true;
      }
    } catch {}

    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { method: 'GET' });
      if (res.ok) cdpOnline = true;
    } catch {}

    if (mcpOnline) {
      statusDot.className = 'dot online';
      statusText.textContent = 'MCP Online';
      bridgeVal.textContent = cdpOnline ? 'CDP + WS' : 'WebSocket';
    } else {
      statusDot.className = 'dot offline';
      statusText.textContent = 'MCP Offline';
      bridgeVal.textContent = cdpOnline ? 'CDP Ready' : 'Standby';
    }
  }

  checkStatus();

  // 4. Copy snippet
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(mcpCode.textContent).then(() => {
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => copyBtn.textContent = '📋 Copy', 1800);
    });
  });

  // 5. Open Settings Page
  openSettingsBtn.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });
});
