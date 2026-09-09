# 🌿 Wrave MCP Server

> **AI-Native Model Context Protocol (MCP) Browser Automation Gateway for Brave Browser**  
> Connect **Google Antigravity**, **Claude Code**, **Claude Desktop**, **OpenAI Codex**, **OpenCode**, **Cursor**, and any MCP-compliant AI agent directly to your active Brave browser.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-2024--11--05-brightgreen.svg)](https://modelcontextprotocol.io/)

---

## ⚡ Overview

Wrave bridges AI coding assistants and agents to your real Brave browser session with zero friction:

- 🛡️ **Zero Native Interference**: Leaves Brave Leo AI, Brave Rewards, Web3 Wallet, and Brave News completely untouched.
- 🎯 **Preserves Native New Tab**: Never overrides or hijacks your default New Tab experience.
- 🚀 **Ultra-Fast In-Memory Automation**: Sub-20ms tool execution with intelligent loopback connection caching.
- 🕹️ **Dual Transport Support**:
  - **Stdio Mode**: Auto-launched by AI harnesses on demand (zero background server to manage).
  - **HTTP/SSE Server**: Persistent local server on port `:8282` (similar to Figma Dev Mode).
- 🔌 **Hybrid Engine (CDP + Extension Bridge)**:
  - **CDP Engine** (`:9222`): Zero-latency, full-fidelity DOM, screenshots, and native mouse/keyboard events.
  - **Extension Bridge** (`:8282/extension`): Seamless WebSocket fallback directly through the extension without requiring special browser startup flags.
- 💎 **100% Written in TypeScript**: Strongly typed, fully tested, and compiled cleanly with ESM.

---

## 🚀 Step 1: Install the Brave Extension

1. Open Brave and navigate to:
   ```
   brave://extensions
   ```
2. Enable the **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked** and select the folder:
   ```
   src/wrave-extension
   ```
4. Pin the **Wrave MCP server** icon to your toolbar.

---

## 🤖 Connect Your AI Harness

### 1. Google Antigravity

Add Wrave to `~/.gemini/config/mcp_config.json`:

#### Option A: On-Demand Stdio (Recommended - Zero Server to Start)
```json
{
  "mcpServers": {
    "wrave": {
      "command": "npx",
      "args": ["-y", "wrave-mcp", "--stdio"]
    }
  }
}
```
*(Or point to your local build: `"command": "node"`, `"args": ["<path-to-wrave>/dist/wrave-engine/cli.js", "--stdio"]`)*.

#### Option B: Persistent Local Server
If running `npx wrave-mcp --server`:
```json
{
  "mcpServers": {
    "wrave": {
      "serverUrl": "http://127.0.0.1:8282/mcp"
    }
  }
}
```

---

### 2. Claude Code (CLI)

Run in your terminal or workspace:

```bash
# Stdio on-demand
claude mcp add wrave -- npx -y wrave-mcp --stdio

# Or connect to persistent HTTP/SSE server:
claude mcp add wrave -- http://127.0.0.1:8282/mcp/sse
```

---

### 3. Claude Desktop

Add to your `claude_desktop_config.json`:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wrave": {
      "command": "npx",
      "args": ["-y", "wrave-mcp", "--stdio"]
    }
  }
}
```

---

### 4. OpenAI Codex & OpenCode

For OpenCode or Codex harnesses, add to `opencode.json` or your harness settings:

```json
{
  "mcp": {
    "servers": {
      "wrave": {
        "command": "npx",
        "args": ["-y", "wrave-mcp", "--stdio"]
      }
    }
  }
}
```

Or connect via HTTP endpoint:
```json
{
  "mcp": {
    "servers": {
      "wrave": {
        "url": "http://127.0.0.1:8282/mcp"
      }
    }
  }
}
```

---

### 5. Cursor & Windsurf

Add to `~/.cursor/mcp.json` or `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "wrave": {
      "command": "npx",
      "args": ["-y", "wrave-mcp", "--stdio"]
    }
  }
}
```

---

## 🧰 Available MCP Tools (18 Primitives)

| Tool Name | Description | Key Arguments |
|---|---|---|
| `wrave_list_tabs` | List all open tabs with ID, title, URL, and active state. | *None* |
| `wrave_open_tab` | Open a new tab with specified URL. | `url`, `activate` (bool) |
| `wrave_close_tab` | Close an open tab by its ID. | `tab_id` |
| `wrave_focus_tab` | Bring tab to foreground and activate it. | `tab_id` |
| `wrave_reload_tab` | Reload tab with optional cache bypass. | `tab_id`, `ignore_cache` |
| `wrave_get_tab_state` | Read title, URL, viewport dimensions, and scroll position. | `tab_id` |
| `wrave_get_dom_tree` | Extract clean, LLM-friendly DOM tree with bounding boxes `[x, y, w, h]` or raw HTML. | `tab_id`, `max_depth`, `html` |
| `wrave_get_accessibility_tree` | Extract full AX accessibility tree (roles, labels, values). | `tab_id` |
| `wrave_take_screenshot` | Capture viewport or full-page screenshot as base64 image. | `tab_id`, `full_page`, `format` |
| `wrave_click` | Dispatch click to element selector or pixel coordinates. Supports `text:` query. | `tab_id`, `selector`, `x`, `y` |
| `wrave_double_click` | Dispatch double-click to element selector. | `tab_id`, `selector` |
| `wrave_type_text` | Type text into inputs, textareas, and rich contenteditable editors. | `tab_id`, `selector`, `text`, `clear_first` |
| `wrave_press_key` | Dispatch native keyboard key event (Enter, Tab, Escape, etc.). | `tab_id`, `key` |
| `wrave_scroll_page` | Scroll viewport or target scrollable container. | `tab_id`, `delta_y`, `delta_x` |
| `wrave_execute_script` | Evaluate arbitrary JavaScript expression in tab context. | `tab_id`, `script` |
| `wrave_get_cookies` | Retrieve cookies for the active domain. | `tab_id` |
| `wrave_print_to_pdf` | Export active page to PDF document. | `tab_id` |
| `wrave_get_console_logs` | Retrieve intercepted console logs from the page. | `tab_id` |

---

## 🛠️ Development & Building from Source

```bash
# 1. Clone repository
git clone https://github.com/AMARA-Khaled/wrave.git
cd wrave

# 2. Install dependencies
npm install

# 3. Build TypeScript codebase
npm run build

# 4. Run automated test suite
npm test

# 5. Package extension bundle
npm run pack:extension
```

---

## 📁 Repository Architecture

```
wrave/
├── package.json              # Unified npm package manifest with TypeScript tooling
├── tsconfig.json             # ES2022 / NodeNext compiler configuration
├── dist/
│   ├── wrave-engine/         # Compiled TypeScript JavaScript & d.ts declarations
│   └── wrave-extension-*.zip # Ready-to-publish Chrome Web Store zip bundle
└── src/
    ├── wrave-extension/      # Unpacked Brave Browser Extension (MV3)
    │   ├── manifest.json     # Clean DevTools/MCP toolbar manifest
    │   ├── background.js     # Background Service Worker & WebSocket bridge
    │   ├── popup.html/css/js # Minimal dark-mode status popup
    │   └── options.html/css/js# Diagnostic & settings page
    └── wrave-engine/         # TypeScript MCP Engine Source
        ├── types.ts          # Strong MCP & browser protocol interfaces
        ├── cdp-engine.ts     # High-speed Chrome DevTools Protocol client
        ├── mcp-server.ts     # Dual SSE / Stdio JSON-RPC 2.0 MCP server
        ├── cli.ts            # CLI daemon & stdio launcher
        └── test/             # Automated test suite
```

---

## 📄 License

MIT © [AMARA Khaled](https://github.com/AMARA-Khaled)
