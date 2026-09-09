# 🌿 Wrave - AI Browser Gateway

> **Model Context Protocol (MCP) Browser Gateway for Brave Browser**  
> Connect Claude Code, Google Antigravity, OpenCode, and AI agents directly to your real Brave browser session.

---

## ⚡ Overview

Wrave gives AI coding assistants real-time, bidirectional control over your Brave browser without tampering with Brave's native defaults:

- 🛡️ **Zero Native Interference**: Leaves Brave Leo AI, Rewards, Wallet, and News completely intact.
- 🎯 **Preserves Native New Tab**: Does not override your default New Tab page.
- 🕹️ **Dual-Mode MCP Companion**:
  - **Stdio Mode**: Runs on-demand when Claude Code requests it (zero background server needed).
  - **HTTP/SSE Mode**: Runs a local server on port `:8282` for web-based AI harnesses.
- 🔌 **Hybrid Automation Engine**:
  - **CDP Engine** (port `:9222`): Zero-latency, full-fidelity DOM, screenshots, and native mouse/keyboard dispatch.
  - **Extension Bridge**: Automatic WebSocket fallback directly through the extension.
- ⚙️ **Wrave MCP Settings**: Dedicated settings page (`options.html`) to configure security permissions, ports, and diagnostic tests.
- 🌿 **Weedex Mascot**: Quick-status toolbar action button.

---

## 🚀 Quick Start

### Step 1: Load the Wrave Extension into Brave

1. Open Brave and navigate to:
   ```
   brave://extensions
   ```
2. Enable **Developer mode** toggle (top-right corner).
3. Click **Load unpacked** and select the folder:
   ```
   src/wrave-extension
   ```
4. Pin the **Wrave** icon to your toolbar. You will see the Weedex mascot!

---

### Step 2: Connect Claude Code (Stdio Mode)

In your terminal or workspace, simply run:

```bash
claude mcp add wrave -- node "C:\Users\walid\Desktop\weed\wrave\src\wrave-engine\cli.js" --stdio
```

*Claude Code will automatically spin up the Wrave MCP engine on demand whenever browser tools are needed.*

---

### Step 3: Connect via HTTP/SSE Server (Port 8282)

If you prefer running a persistent local server:

1. Start the Wrave engine:
   ```bash
   npm start
   # or: node src/wrave-engine/cli.js --server --port 8282
   ```

2. Add to Claude Code or Antigravity:
   ```bash
   claude mcp add wrave -- http://127.0.0.1:8282/mcp/sse
   ```

3. Or add to your `mcpServers` configuration (`claude_desktop_config.json` / `agy.json`):
   ```json
   {
     "mcpServers": {
       "wrave": {
         "url": "http://127.0.0.1:8282/mcp/sse"
       }
     }
   }
   ```

---

## 🧰 Available MCP Tools

| Tool Name | Description |
|---|---|
| `wrave_list_tabs` | List all open tabs (ID, title, URL, active state). |
| `wrave_open_tab` | Open a new tab with specified URL. |
| `wrave_close_tab` | Close an open tab by ID. |
| `wrave_focus_tab` | Bring tab to foreground and focus it. |
| `wrave_reload_tab` | Reload tab with optional cache bypass. |
| `wrave_get_tab_state` | Read title, URL, viewport dimensions, and scroll position. |
| `wrave_get_dom_tree` | Extract clean, LLM-friendly DOM tree with bounding boxes `[x, y, w, h]`. |
| `wrave_get_accessibility_tree` | Extract full AX accessibility tree (roles, labels, values). |
| `wrave_take_screenshot` | Capture viewport or full-page screenshot as base64 PNG/JPEG. |
| `wrave_click` | Dispatch click to element selector or pixel coordinates. |
| `wrave_double_click` | Dispatch double-click to element. |
| `wrave_type_text` | Type text into an input or textarea field. |
| `wrave_press_key` | Send keyboard key (Enter, Escape, Tab, Backspace). |
| `wrave_scroll_page` | Scroll viewport by `deltaX` and `deltaY`. |
| `wrave_execute_script` | Evaluate arbitrary JavaScript expression in tab context. |
| `wrave_get_cookies` | Retrieve cookies for the active domain. |
| `wrave_print_to_pdf` | Export active page to PDF document. |
| `wrave_get_console_logs` | Retrieve intercepted console logs from the page. |

---

## 🛡️ Security & Settings

Right-click the **Wrave** toolbar icon and select **Options** (or click **Wrave MCP Settings** in the popup):

- **Sensitive Form Gate**: Block AI from auto-submitting password and credit card fields without manual confirmation.
- **Port Customization**: Adjust MCP port (`8282`) and CDP port (`9222`).
- **Diagnostic Console**: Run test tab queries and ping the daemon directly from the browser UI.

---

## 📁 Repository Structure

```
wrave/
├── package.json
├── README.md
└── src/
    ├── wrave-extension/       # Unpacked Brave Extension (Manifest V3)
    │   ├── manifest.json
    │   ├── background.js      # Service Worker & WebSocket bridge
    │   ├── popup.html/js/css  # Toolbar popup with Weedex mascot
    │   ├── options.html/js/css# "Wrave MCP" Settings page
    │   └── icons/             # Official Weedex mascot icons
    └── wrave-engine/          # Dual-Mode MCP Companion
        ├── cli.js             # CLI entrypoint (stdio & http)
        ├── mcp-server.js      # JSON-RPC 2.0 MCP protocol server
        └── cdp-engine.js      # Direct Chrome DevTools Protocol client
```
