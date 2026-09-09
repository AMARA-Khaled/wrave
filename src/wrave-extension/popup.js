document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const copyBtn = document.getElementById('copyBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const reconnectBtn = document.getElementById('reconnectBtn');
  const mcpCode = document.getElementById('mcpCode');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const mcpPortVal = document.getElementById('mcpPortVal');
  const cdpPortVal = document.getElementById('cdpPortVal');
  const bridgeVal = document.getElementById('bridgeVal');

  let mcpPort = 8282;
  let cdpPort = 9222;

  try {
    const data = await chrome.storage.local.get(['mcpPort', 'cdpPort']);
    if (data.mcpPort) mcpPort = data.mcpPort;
    if (data.cdpPort) cdpPort = data.cdpPort;
  } catch {}

  mcpPortVal.textContent = `:${mcpPort}`;
  cdpPortVal.textContent = `:${cdpPort}`;

  async function checkStatus() {
    statusDot.className = 'status-dot';
    statusText.textContent = 'Checking';
    bridgeVal.textContent = 'Testing...';

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
      statusDot.className = 'status-dot online';
      statusText.textContent = 'Online';
      bridgeVal.textContent = cdpOnline ? 'CDP + WS Bridge' : 'WebSocket Bridge';
    } else {
      statusDot.className = 'status-dot offline';
      statusText.textContent = 'Offline';
      bridgeVal.textContent = cdpOnline ? 'CDP Ready (Port 9222)' : 'Disconnected';
    }
  }

  checkStatus();

  refreshBtn.addEventListener('click', () => {
    checkStatus();
  });

  reconnectBtn.addEventListener('click', async () => {
    reconnectBtn.textContent = 'Reconnecting...';
    try {
      await chrome.runtime.sendMessage({ action: 'reconnect' });
    } catch {}
    setTimeout(async () => {
      await checkStatus();
      reconnectBtn.textContent = 'Reconnect';
    }, 1000);
  });

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(mcpCode.textContent).then(() => {
      copyBtn.textContent = 'Copied';
      setTimeout(() => copyBtn.textContent = 'Copy', 1500);
    });
  });

  openSettingsBtn.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });
});
