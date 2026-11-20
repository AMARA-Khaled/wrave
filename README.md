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

## Available MCP Tools (28)

`tab_id` is optional on every tool except close/focus: it defaults to the tab you last opened or used. Element targets accept a snapshot ref (`@3`), a CSS selector, or `text:Visible label`. Actions wait for navigations, in-flight requests and DOM updates to settle before returning, so fixed sleeps are unnecessary.

### Fast Paths
| Tool Name | Description | Key Parameters |
|---|---|---|
| `wrave_batch` | Run several tools in sequence in one call; stops on first error. | `steps` [{tool, args}], `stop_on_error`, `snapshot_after` |
| `wrave_fill_form` | Fill text inputs, selects and checkboxes in one call, optionally click submit. | `fields` [{selector, value}], `submit` |
| `wrave_get_snapshot` | Compact one-line-per-element list of interactive elements with `@refs`, values, options and state. | `max_elements`, `viewport_only`, `include_boxes` |
| `wrave_get_text` | Readable text of the page or one element. | `selector`, `max_chars` |
| `wrave_click_and_read` | Click, wait for the page to settle, return the updated snapshot. | `selector`, `x`, `y` |
| `wrave_type_and_submit` | Type into a field, press Enter, wait for the result. | `selector`, `text`, `clear_first`, `submit_key` |

### Tabs & Navigation
| Tool Name | Description | Key Parameters |
|---|---|---|
| `wrave_list_tabs` | List open tabs (id, title, url). | *None* |
| `wrave_open_tab` | Open a URL, wait for load, return tab id plus snapshot. | `url`, `activate`, `snapshot` |
| `wrave_navigate` | Load a URL or go back/forward/reload in the current tab, return snapshot. | `url`, `action`, `timeout_ms` |
| `wrave_close_tab` | Close a tab. | `tab_id` |
| `wrave_focus_tab` | Bring a tab to the foreground and make it the default. | `tab_id` |
| `wrave_reload_tab` | Reload and wait for load. | `ignore_cache` |
| `wrave_wait_for` | Wait for a selector or text to appear (or disappear), or for the page to settle. | `selector`, `text`, `gone`, `timeout_ms` |

### Interaction
| Tool Name | Description | Key Parameters |
|---|---|---|
| `wrave_click` | Click an element (auto scroll-into-view) or coordinates. | `selector`, `x`, `y`, `snapshot` |
| `wrave_double_click` | Double-click an element or coordinates. | `selector`, `x`, `y` |
| `wrave_hover` | Move the mouse over an element. | `selector` |
| `wrave_type_text` | Insert text instantly into inputs, textareas and contenteditable editors. | `selector`, `text`, `clear_first` |
| `wrave_press_key` | Press a key or combo (Enter, Tab, ArrowDown, Control+a, Shift+Tab). | `key`, `repeat` |
| `wrave_select_option` | Choose a native `<select>` option by value or label. | `selector`, `value` |
| `wrave_scroll_page` | Scroll by amount, to top/bottom, or to an element. | `delta_y`, `to`, `selector` |

### Inspection & Diagnostics
| Tool Name | Description | Key Parameters |
|---|---|---|
| `wrave_get_tab_state` | Title, URL, load state, viewport and scroll position. | *None* |
| `wrave_get_dom_tree` | Nested DOM tree with bounding boxes, or raw HTML (extension mode). | `max_depth`, `html` |
| `wrave_get_accessibility_tree` | Compact accessibility outline, one `role "name"` per line. | `max_nodes` |
| `wrave_take_screenshot` | Viewport or full-page screenshot (JPEG by default). | `full_page`, `format`, `quality` |
| `wrave_execute_script` | Evaluate JavaScript in the page (top-level await supported). | `script` |
| `wrave_get_cookies` | Cookies for the current page. | *None* |
| `wrave_print_to_pdf` | Save the page as a PDF file and return its path. | `path` |
| `wrave_get_console_logs` | Console messages and uncaught exceptions. | `clear` |

In extension-bridge mode (no `--remote-debugging-port`), `wrave_hover`, `wrave_select_option`, `wrave_fill_form`, `wrave_wait_for`, back/forward navigation, the accessibility tree, PDF export and console logs require CDP.

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
