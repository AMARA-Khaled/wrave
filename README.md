# Wrave

> High-performance Model Context Protocol (MCP) gateway for Brave Browser.  
> Direct, low-latency browser automation for Claude Code, Antigravity, Codex, Cursor, and MCP clients.

[![npm version](https://img.shields.io/npm/v/wrave-mcp.svg)](https://www.npmjs.com/package/wrave-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## Overview

Wrave provides full programmatic control of your active Brave browser session through the Model Context Protocol (MCP). It gives coding assistants and developer workflows direct access to interact with, inspect, and navigate live web applications:

- **1-Turn Compound Actions**: High-speed primitives like `click_and_read` and `type_and_submit` that combine interaction and page inspection into a single round-trip.
- **Semantic Element Indexing**: Surfaces interactive elements with numbered references (`@1`, `@2`, `@3`, etc.), bounding boxes, and accessibility roles—eliminating brittle CSS selectors on dynamic apps.
- **Full-Spectrum Inspection**: Clean DOM trees, accessibility hierarchies, full-page or viewport screenshots, intercepted console logs, network cookies, and tab state.
- **Dual Transport Modes**: Works out of the box on demand via `stdio` (zero background services to manage) or as a local HTTP/SSE service.
- **Zero Browser Modifications**: Runs directly alongside your everyday browser session without requiring special startup flags or separate browser drivers.

---

## Installation in Brave Browser

1. Download the latest `wrave-extension-v*.zip` from [GitHub Releases](https://github.com/AMARA-Khaled/wrave/releases/latest) and extract it.
2. Open Brave and navigate to:
   ```
   brave://extensions
   ```
3. Enable the **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** and select the extracted folder.
5. (Optional) Pin the Wrave icon to your toolbar for quick status monitoring.

---

## Connect Your Client

Wrave supports automatic `stdio` launching (recommended) and connecting to a persistent local server.

### 1. Google Antigravity

Add Wrave to `~/.gemini/config/mcp_config.json`:

#### Option A: On-Demand Stdio (Recommended)
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

Add to Claude Code with a single command:

```bash
# On-demand stdio (recommended)
claude mcp add wrave -- npx -y wrave-mcp --stdio

# Or connect to a running local server:
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

Add to your `opencode.json` configuration:

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

## Available MCP Tools (21 Primitives)

### Compound Actions (1-Turn)
| Tool Name | Description | Parameters |
|---|---|---|
| `wrave_get_snapshot` | Instant page snapshot with indexed interactive elements (`@1`, `@2`, etc.), title, and URL. | `tab_id` |
| `wrave_click_and_read` | Click an element (by selector, `@ref` like `@1`, or x/y) and immediately return the updated page snapshot. | `tab_id`, `selector`, `x`, `y` |
| `wrave_type_and_submit` | Type text into an input or contenteditable field and submit with Enter in 1 turn. | `tab_id`, `selector`, `text`, `clear_first`, `submit_key` |

### Core Navigation & Inspection
| Tool Name | Description | Parameters |
|---|---|---|
| `wrave_list_tabs` | List all open tabs with ID, title, URL, and active state. | *None* |
| `wrave_open_tab` | Open a new tab with specified URL (auto-returns page snapshot & indexed elements). | `url`, `activate` (bool) |
| `wrave_close_tab` | Close an open tab by its ID. | `tab_id` |
| `wrave_focus_tab` | Bring tab to foreground and activate it. | `tab_id` |
| `wrave_reload_tab` | Reload tab with optional cache bypass. | `tab_id`, `ignore_cache` |
| `wrave_get_tab_state` | Read title, URL, viewport dimensions, and scroll position. | `tab_id` |
| `wrave_get_dom_tree` | Extract clean, LLM-friendly DOM tree with bounding boxes `[x, y, w, h]` or raw HTML. | `tab_id`, `max_depth`, `html` |
| `wrave_get_accessibility_tree` | Extract full AX accessibility tree (roles, labels, values). | `tab_id` |
| `wrave_take_screenshot` | Capture viewport or full-page screenshot as base64 image. | `tab_id`, `full_page`, `format` |

### Direct Interaction Primitives
| Tool Name | Description | Parameters |
|---|---|---|
| `wrave_click` | Dispatch click to element selector, `@ref` (e.g. `@1`), or pixel coordinates. | `tab_id`, `selector`, `x`, `y` |
| `wrave_double_click` | Dispatch double-click to element selector or `@ref`. | `tab_id`, `selector` |
| `wrave_type_text` | Type text into inputs, textareas, and rich contenteditable editors (`@ref` supported). | `tab_id`, `selector`, `text`, `clear_first` |
| `wrave_press_key` | Dispatch native keyboard key event (Enter, Tab, Escape, etc.). | `tab_id`, `key` |
| `wrave_scroll_page` | Scroll viewport or target scrollable container. | `tab_id`, `delta_y`, `delta_x` |
| `wrave_execute_script` | Evaluate arbitrary JavaScript expression in tab context. | `tab_id`, `script` |
| `wrave_get_cookies` | Retrieve cookies for the active domain. | `tab_id` |
| `wrave_print_to_pdf` | Export active page to PDF document. | `tab_id` |
| `wrave_get_console_logs` | Retrieve intercepted console logs from the page. | `tab_id` |

---

## Development & Building from Source

```bash
# 1. Clone repository
git clone https://github.com/AMARA-Khaled/wrave.git
cd wrave

# 2. Install dependencies
npm install

# 3. Build codebase
npm run build

# 4. Run automated test suite
npm test

# 5. Package extension bundle
npm run pack:extension
```

---

## License

MIT © [AMARA Khaled](https://github.com/AMARA-Khaled)
