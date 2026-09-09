/**
 * Wrave Security Approval Banner
 * Displays interactive security consent prompts when AI agents attempt sensitive actions.
 */
(function () {
  if (window.__WRAVE_SECURITY_BANNER_INITIALIZED__) return;
  window.__WRAVE_SECURITY_BANNER_INITIALIZED__ = true;

  const host = document.createElement('div');
  host.id = 'wrave-security-banner-host';
  host.style.cssText = 'position:fixed;top:0;left:0;width:100%;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

    .banner-container {
      width: 90%;
      max-width: 780px;
      margin: 14px auto;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(234, 179, 8, 0.6);
      border-radius: 12px;
      padding: 12px 18px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6), 0 0 24px rgba(234, 179, 8, 0.2);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      pointer-events: auto;
      transform: translateY(-80px);
      opacity: 0;
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
    }

    .banner-container.visible {
      transform: translateY(0);
      opacity: 1;
    }

    .banner-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
    }

    .shield-icon {
      width: 28px;
      height: 28px;
      fill: #eab308;
      filter: drop-shadow(0 0 6px rgba(234, 179, 8, 0.4));
      flex-shrink: 0;
    }

    .banner-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .banner-title {
      font-size: 13px;
      font-weight: 700;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .agent-pill {
      background: rgba(34, 197, 94, 0.2);
      border: 1px solid #22c55e;
      color: #4ade80;
      font-size: 11px;
      padding: 1px 7px;
      border-radius: 10px;
      font-weight: 600;
    }

    .banner-detail {
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.4;
    }

    .banner-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .btn {
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      border: 1px solid transparent;
    }

    .btn-allow-once {
      background: #22c55e;
      color: #052e16;
    }
    .btn-allow-once:hover {
      background: #4ade80;
      transform: translateY(-1px);
    }

    .btn-always {
      background: rgba(30, 41, 59, 0.9);
      border-color: #475569;
      color: #e2e8f0;
    }
    .btn-always:hover {
      background: #334155;
      color: #ffffff;
    }

    .btn-deny {
      background: rgba(239, 68, 68, 0.15);
      border-color: #ef4444;
      color: #f87171;
    }
    .btn-deny:hover {
      background: #ef4444;
      color: #ffffff;
    }
  `;
  shadow.appendChild(style);

  const container = document.createElement('div');
  container.className = 'banner-container';
  container.innerHTML = `
    <div class="banner-left">
      <svg class="shield-icon" viewBox="0 0 24 24">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v6h-2V7zm0 8h2v2h-2v-2z"/>
      </svg>
      <div class="banner-text">
        <div class="banner-title">
          <span>AI Permission Request</span>
          <span class="agent-pill" id="wrave-agent-name">Claude Code</span>
        </div>
        <div class="banner-detail" id="wrave-action-detail">
          The agent is requesting to type into a sensitive credential field.
        </div>
      </div>
    </div>
    <div class="banner-actions">
      <button class="btn btn-allow-once" id="wrave-allow-once">Allow Once</button>
      <button class="btn btn-always" id="wrave-allow-always">Always Allow Site</button>
      <button class="btn btn-deny" id="wrave-deny">Deny</button>
    </div>
  `;
  shadow.appendChild(container);

  let activeResolver = null;

  const agentNameEl = container.querySelector('#wrave-agent-name');
  const actionDetailEl = container.querySelector('#wrave-action-detail');
  const allowOnceBtn = container.querySelector('#wrave-allow-once');
  const allowAlwaysBtn = container.querySelector('#wrave-allow-always');
  const denyBtn = container.querySelector('#wrave-deny');

  function respond(decision) {
    container.classList.remove('visible');
    if (activeResolver) {
      activeResolver(decision);
      activeResolver = null;
    }
  }

  allowOnceBtn.addEventListener('click', () => respond('allow_once'));
  allowAlwaysBtn.addEventListener('click', () => respond('always_allow'));
  denyBtn.addEventListener('click', () => respond('deny'));

  window.__WRAVE_SECURITY__ = {
    requestApproval(agentName, actionDescription) {
      agentNameEl.textContent = agentName || 'AI Agent';
      actionDetailEl.textContent = actionDescription || 'Sensitive action requested.';
      container.classList.add('visible');

      return new Promise((resolve) => {
        activeResolver = resolve;
      });
    },
    dismiss() {
      respond('deny');
    }
  };
})();
