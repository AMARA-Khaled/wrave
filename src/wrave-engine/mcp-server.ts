/**
 * Wrave Model Context Protocol (MCP) Server (TypeScript)
 * Exposes Wrave browser automation to AI harnesses (Claude Code, Antigravity, Codex, OpenCode).
 * Supports SSE, Stdio, and HTTP POST JSON-RPC 2.0 with Bearer token authentication.
 * Includes Extension WebSocket bridge for fallback automation when CDP is not enabled.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';
import { WraveCdpEngine, normalizeUrl } from './cdp-engine.js';
import { getToolsDefinition, formatSnapshot, SERVER_INSTRUCTIONS } from './tool-definitions.js';
import {
  McpServerOptions,
  McpToolDefinition,
  JsonRpcRequest,
  JsonRpcResponse,
  McpToolCallResult,
  McpToolResultContent,
} from './types.js';

/** Compact (non-indented) serialization: indentation alone roughly doubles token cost. */
function compact(value: any): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export class WraveMcpServer {
  public port: number;
  public host: string;
  public authToken: string;
  public requireAuth: boolean;
  public cdpEngine: WraveCdpEngine;
  private sseSessions: Map<string, http.ServerResponse>;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  public extensionSocket: WebSocket | null = null;
  private pendingBridgeRequests: Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>;
  private bridgeMessageId: number = 1;
  private lastCdpTabId: string | null = null;
  private lastBridgeTabId: string | number | null = null;

  constructor(options: McpServerOptions = {}) {
    this.port = options.port || 8282;
    this.host = options.host || '127.0.0.1';
    this.authToken = options.authToken || crypto.randomBytes(16).toString('hex');
    this.requireAuth = options.requireAuth ?? false;
    this.cdpEngine = new WraveCdpEngine(options.cdpOptions || {});
    this.sseSessions = new Map<string, http.ServerResponse>();
    this.pendingBridgeRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  }

  getToolsDefinition(): McpToolDefinition[] {
    return getToolsDefinition();
  }

  async sendBridgeCommand(method: string, params: Record<string, any> = {}, timeoutMs = 15000): Promise<any> {
    if (!this.extensionSocket || this.extensionSocket.readyState !== WebSocket.OPEN) {
      throw new Error('Extension bridge is not connected.');
    }
    const id = this.bridgeMessageId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBridgeRequests.delete(id);
        reject(new Error(`Bridge command "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingBridgeRequests.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.extensionSocket!.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Resolve the tab a tool call targets. An explicit tab_id becomes the new default;
   * otherwise the last used tab is reused, falling back to the most recent page tab.
   */
  private async resolveCdpTab(args: Record<string, any>): Promise<string> {
    if (args.tab_id !== undefined && args.tab_id !== null && args.tab_id !== '') {
      this.lastCdpTabId = String(args.tab_id);
      return this.lastCdpTabId;
    }
    if (this.lastCdpTabId && this.cdpEngine.hasLiveSession(this.lastCdpTabId)) return this.lastCdpTabId;
    const tabs = await this.cdpEngine.listTabs();
    if (this.lastCdpTabId && tabs.some((t) => t.id === this.lastCdpTabId)) return this.lastCdpTabId;
    const page = tabs.find((t) => /^https?:|^file:/.test(t.url)) || tabs[0];
    if (!page) throw new Error('No open tabs. Use wrave_open_tab first.');
    this.lastCdpTabId = String(page.id);
    return this.lastCdpTabId;
  }

  async handleMcpToolCall(name: string, args: Record<string, any> = {}, _callerName = 'AI Harness'): Promise<any> {
    if (name === 'wrave_batch') return this.runBatch(args);

    if (await this.cdpEngine.isCdpAvailable()) {
      try {
        return await this.callCdpTool(name, args);
      } catch (err: any) {
        if (/fetch failed|ECONNREFUSED|socket hang up/i.test(err.message || '')) this.cdpEngine.invalidateAvailability();
        throw err;
      }
    }

    if (this.extensionSocket && this.extensionSocket.readyState === WebSocket.OPEN) {
      return this.callBridgeTool(name, args);
    }

    throw new Error('Brave is not connected. Either start Brave with --remote-debugging-port=9222 or open Brave with the Wrave Extension loaded.');
  }

  private snapshotOpts(args: Record<string, any>) {
    return {
      maxElements: args.max_elements,
      viewportOnly: args.viewport_only,
      dismissDialogs: args.dismiss_popups,
    };
  }

  /** Appends a formatted snapshot to an action result when requested. */
  private async withSnapshot(tabId: string, result: any, args: Record<string, any>, defaultOn: boolean): Promise<any> {
    const want = args.snapshot ?? defaultOn;
    if (!want) return result;
    const snap = await this.cdpEngine.getSnapshot(tabId, this.snapshotOpts(args));
    return `${compact(result)}\n${formatSnapshot(snap)}`;
  }

  private async callCdpTool(name: string, args: Record<string, any>): Promise<any> {
    const e = this.cdpEngine;
    const target = () => (args.x !== undefined && args.y !== undefined ? { x: args.x, y: args.y } : args.selector);

    switch (name) {
      case 'wrave_list_tabs': {
        const tabs = await e.listTabs();
        return tabs.map((t) => ({ ...t, ...(t.id === this.lastCdpTabId ? { default: true } : {}) }));
      }
      case 'wrave_open_tab': {
        const tab = await e.openTab(args.url, args.activate !== false);
        this.lastCdpTabId = tab.id;
        return this.withSnapshot(tab.id, { tab_id: tab.id, status: 'opened' }, args, true);
      }
      case 'wrave_close_tab': {
        const res = await e.closeTab(String(args.tab_id));
        if (this.lastCdpTabId === String(args.tab_id)) this.lastCdpTabId = null;
        return res;
      }
      case 'wrave_focus_tab':
        this.lastCdpTabId = String(args.tab_id);
        return await e.focusTab(this.lastCdpTabId);
    }

    const tabId = await this.resolveCdpTab(args);
    switch (name) {
      case 'wrave_navigate': {
        let res;
        if (args.action === 'back') res = await e.goHistory(tabId, -1, args.timeout_ms);
        else if (args.action === 'forward') res = await e.goHistory(tabId, 1, args.timeout_ms);
        else if (args.action === 'reload') res = await e.reloadTab(tabId);
        else if (args.url) res = await e.navigate(tabId, args.url, args.timeout_ms || 15000);
        else throw new Error('Provide url or action (back | forward | reload).');
        return this.withSnapshot(tabId, res, args, true);
      }
      case 'wrave_reload_tab':
        return await e.reloadTab(tabId, args.ignore_cache);
      case 'wrave_get_tab_state':
        return await e.getTabState(tabId);
      case 'wrave_get_snapshot':
        return formatSnapshot(await e.getSnapshot(tabId, this.snapshotOpts(args)), !!args.include_boxes);
      case 'wrave_get_text': {
        const r = await e.getText(tabId, args.selector, args.max_chars);
        return `Page: ${r.title}\nURL: ${r.url}\n\n${r.text}${r.truncated ? `\n\n[truncated at ${args.max_chars || 8000} chars; pass a larger max_chars or a selector]` : ''}`;
      }
      case 'wrave_get_dom_tree':
        return await e.getDomTree(tabId, args.max_depth || 4);
      case 'wrave_get_accessibility_tree':
        return await e.getAccessibilityTree(tabId, args.max_nodes || 400);
      case 'wrave_take_screenshot': {
        const format = args.format === 'png' ? 'png' : 'jpeg';
        const shot = await e.takeScreenshot(tabId, format, args.quality || 70, !!args.full_page);
        return { _isImage: true, mimeType: `image/${shot.format}`, data: shot.dataBase64 };
      }
      case 'wrave_click': {
        const res = await e.click(tabId, target());
        res.wait = await e.waitForIdle(tabId);
        return this.withSnapshot(tabId, res, args, false);
      }
      case 'wrave_click_and_read':
        return formatSnapshot(await e.clickAndRead(tabId, target(), this.snapshotOpts(args)));
      case 'wrave_double_click':
        return await e.doubleClick(tabId, target());
      case 'wrave_hover':
        return await e.hover(tabId, target());
      case 'wrave_type_text':
        return await e.typeText(tabId, args.selector, String(args.text ?? ''), !!args.clear_first);
      case 'wrave_type_and_submit': {
        const res = await e.typeAndSubmit(tabId, args.selector, String(args.text ?? ''), args.clear_first !== false, args.submit_key || 'Enter');
        return this.withSnapshot(tabId, res, args, false);
      }
      case 'wrave_press_key': {
        const n = Math.min(Math.max(1, Number(args.repeat) || 1), 100);
        for (let i = 0; i < n; i++) await e.pressKey(tabId, args.key);
        return { key: args.key, times: n, status: 'pressed' };
      }
      case 'wrave_select_option':
        return await e.selectOption(tabId, args.selector, args.value);
      case 'wrave_fill_form': {
        const res = await e.fillForm(tabId, args.fields, args.submit);
        return this.withSnapshot(tabId, res, args, false);
      }
      case 'wrave_scroll_page':
        return await e.scrollPage(tabId, { deltaX: args.delta_x, deltaY: args.delta_y, selector: args.selector, to: args.to });
      case 'wrave_wait_for':
        return await e.waitFor(tabId, { selector: args.selector, text: args.text, gone: !!args.gone, timeoutMs: args.timeout_ms });
      case 'wrave_execute_script':
        return await e.executeScript(tabId, args.script);
      case 'wrave_get_cookies':
        return await e.getCookies(tabId);
      case 'wrave_print_to_pdf': {
        const pdf = await e.printToPdf(tabId);
        const outPath = args.path || path.join(os.tmpdir(), `wrave-${tabId.slice(0, 8)}-${Date.now()}.pdf`);
        await fs.promises.writeFile(outPath, Buffer.from(pdf.dataBase64, 'base64'));
        return { status: 'saved', path: outPath, bytes: Buffer.byteLength(pdf.dataBase64, 'base64') };
      }
      case 'wrave_get_console_logs':
        return await e.getConsoleLogs(tabId, !!args.clear);
      default:
        throw new Error(`Unknown tool "${name}".`);
    }
  }

  private async callBridgeTool(name: string, args: Record<string, any>): Promise<any> {
    if (args.tab_id !== undefined && args.tab_id !== null && args.tab_id !== '') this.lastBridgeTabId = args.tab_id;
    const tabId = args.tab_id ?? this.lastBridgeTabId ?? undefined;
    const target = { selector: args.selector || '', x: args.x, y: args.y };

    switch (name) {
      case 'wrave_list_tabs':
        return await this.sendBridgeCommand('tabs_list');
      case 'wrave_open_tab': {
        const res = await this.sendBridgeCommand('tab_create', { url: normalizeUrl(args.url), active: args.activate !== false });
        if (res && res.tabId !== undefined) this.lastBridgeTabId = res.tabId;
        return `${compact({ tab_id: res.tabId, status: 'opened' })}\n${formatSnapshot(res)}`;
      }
      case 'wrave_navigate': {
        if (!args.url) throw new Error('Extension mode supports wrave_navigate with a url only. Launch Brave with --remote-debugging-port=9222 for back/forward.');
        const res = await this.sendBridgeCommand('page_navigate', { tabId, url: normalizeUrl(args.url) }, 20000);
        return res && res.elements ? formatSnapshot(res) : res;
      }
      case 'wrave_close_tab':
        if (this.lastBridgeTabId === args.tab_id) this.lastBridgeTabId = null;
        return await this.sendBridgeCommand('tab_close', { tabId: args.tab_id });
      case 'wrave_focus_tab':
        return await this.sendBridgeCommand('tab_activate', { tabId: args.tab_id });
      case 'wrave_reload_tab':
        return await this.sendBridgeCommand('tab_reload', { tabId, ignore_cache: args.ignore_cache });
      case 'wrave_get_tab_state':
        return await this.sendBridgeCommand('tab_get_state', { tabId });
      case 'wrave_take_screenshot': {
        const format = args.format === 'png' ? 'png' : 'jpeg';
        const shot = await this.sendBridgeCommand('page_screenshot', { tabId, format });
        const dataBase64 = shot.dataUrl ? shot.dataUrl.replace(/^data:image\/\w+;base64,/, '') : (shot.dataBase64 || '');
        return { _isImage: true, mimeType: `image/${format}`, data: dataBase64 };
      }
      case 'wrave_get_dom_tree':
        return await this.sendBridgeCommand('page_get_dom', { tabId, html: !!args.html });
      case 'wrave_get_text': {
        const res = await this.sendBridgeCommand('page_get_dom', { tabId, html: false });
        const max = args.max_chars || 8000;
        const text = String(res?.content || '').replace(/\n\s*\n+/g, '\n').trim();
        return text.length > max ? `${text.slice(0, max)}\n\n[truncated at ${max} chars]` : text;
      }
      case 'wrave_get_snapshot':
        return formatSnapshot(await this.sendBridgeCommand('page_get_snapshot', { tabId }), !!args.include_boxes);
      case 'wrave_click':
        return await this.sendBridgeCommand('page_click', { tabId, ...target });
      case 'wrave_click_and_read':
        return formatSnapshot(await this.sendBridgeCommand('page_click_and_read', { tabId, ...target }));
      case 'wrave_type_text':
        return await this.sendBridgeCommand('page_type_text', { tabId, selector: args.selector || '', text: args.text || '', clear_first: !!args.clear_first });
      case 'wrave_type_and_submit':
        return await this.sendBridgeCommand('page_type_and_submit', { tabId, selector: args.selector || '', text: args.text || '', clear_first: args.clear_first !== false, submit_key: args.submit_key || 'Enter' });
      case 'wrave_press_key':
        return await this.sendBridgeCommand('page_press_key', { tabId, key: args.key });
      case 'wrave_scroll_page':
        return await this.sendBridgeCommand('page_scroll', { tabId, selector: args.selector, deltaX: args.delta_x || 0, deltaY: args.delta_y ?? 600 });
      case 'wrave_execute_script':
        return await this.sendBridgeCommand('page_execute_js', { tabId, script: args.script });
      case 'wrave_get_cookies':
        return await this.sendBridgeCommand('page_get_cookies', { tabId });
      default:
        throw new Error(`Tool "${name}" requires Chrome DevTools Protocol. Launch Brave with --remote-debugging-port=9222 for full tool access.`);
    }
  }

  /** Runs several tool calls sequentially inside one MCP round trip. */
  private async runBatch(args: Record<string, any>): Promise<any> {
    const steps = args.steps;
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('steps must be a non-empty array of {tool, args}.');
    if (steps.length > 50) throw new Error('A batch can contain at most 50 steps.');
    const lines: string[] = [];
    let failed = false;
    const started = Date.now();
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] || {};
      const tool = String(step.tool || step.name || '');
      const stepArgs = { ...(step.args || step.arguments || {}) };
      if (stepArgs.tab_id === undefined && args.tab_id !== undefined) stepArgs.tab_id = args.tab_id;
      try {
        if (tool === 'wrave_batch') throw new Error('Nested batches are not allowed.');
        const res = await this.handleMcpToolCall(tool, stepArgs);
        const rendered = res && res._isImage ? '(image omitted inside batch; call wrave_take_screenshot directly)' : compact(res);
        lines.push(`[${i + 1}] ${tool}: ${rendered}`);
      } catch (err: any) {
        failed = true;
        lines.push(`[${i + 1}] ${tool}: ERROR ${err.message}`);
        if (args.stop_on_error !== false) {
          if (i < steps.length - 1) lines.push(`Stopped; ${steps.length - i - 1} remaining step(s) skipped.`);
          break;
        }
      }
    }
    if (args.snapshot_after) {
      try {
        lines.push('--- final snapshot ---');
        lines.push(compact(await this.handleMcpToolCall('wrave_get_snapshot', args.tab_id !== undefined ? { tab_id: args.tab_id } : {})));
      } catch (err: any) {
        lines.push(`snapshot failed: ${err.message}`);
      }
    }
    lines.push(`(batch ${failed ? 'finished with errors' : 'ok'} in ${Date.now() - started}ms)`);
    return { _text: lines.join('\n'), _isError: failed };
  }

  async handleRpcMessage(msg: JsonRpcRequest, callerName = 'AI Harness'): Promise<JsonRpcResponse | null> {
    const { id, method, params = {} } = msg;

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: 'wrave-mcp-server',
            version: '1.3.0',
          },
          instructions: SERVER_INSTRUCTIONS,
        },
      };
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: this.getToolsDefinition(),
        },
      };
    }

    if (method === 'tools/call') {
      const toolName = params.name as string;
      const toolArgs = (params.arguments || {}) as Record<string, any>;
      try {
        const toolResult = await this.handleMcpToolCall(toolName, toolArgs, callerName);
        const content: McpToolResultContent[] = [];

        let isError = false;
        if (toolResult && toolResult._isImage) {
          content.push({
            type: 'image',
            data: toolResult.data,
            mimeType: toolResult.mimeType || 'image/png',
          });
        } else if (toolResult && typeof toolResult._text === 'string') {
          content.push({ type: 'text', text: toolResult._text });
          isError = !!toolResult._isError;
        } else {
          content.push({ type: 'text', text: compact(toolResult) });
        }
        return {
          jsonrpc: '2.0',
          id,
          result: { content, isError },
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Tool error [${toolName}]: ${err.message}` }],
            isError: true,
          },
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method "${method}" not found` },
    };
  }

  start(): Promise<{ port: number; host: string; sseUrl: string; token: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

        const hostHeader = (req.headers.host || '').toLowerCase();
        // 1. DNS Rebinding Protection: Host header MUST point to loopback/localhost
        if (hostHeader && !hostHeader.startsWith('127.0.0.1') && !hostHeader.startsWith('localhost') && !hostHeader.startsWith('::1')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden: Invalid Host header' }));
          return;
        }

        // 2. Strict Origin / CORS Protection:
        // Allow requests without Origin (CLI, Antigravity, Claude, curl) or from loopback / browser extensions.
        // Block cross-origin requests originating from external browser webpages.
        const origin = req.headers.origin;
        if (origin) {
          const isAllowedOrigin =
            origin.startsWith('chrome-extension://') ||
            origin.startsWith('moz-extension://') ||
            origin.startsWith('http://127.0.0.1') ||
            origin.startsWith('https://127.0.0.1') ||
            origin.startsWith('http://localhost') ||
            origin.startsWith('https://localhost');

          if (!isAllowedOrigin) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: Cross-origin access from external web pages is blocked.' }));
            return;
          }
          res.setHeader('Access-Control-Allow-Origin', origin);
        } else {
          res.setHeader('Access-Control-Allow-Origin', '*');
        }

        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, mcp-session-id, x-session-id');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Authorization, Mcp-Session-Id, mcp-session-id, x-session-id');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // Token authentication if requireAuth is enabled
        if (this.requireAuth) {
          const authHeader = req.headers.authorization || '';
          const queryToken = parsedUrl.searchParams.get('token');
          const token = authHeader.replace(/^Bearer\s+/i, '') || queryToken;
          if (token !== this.authToken) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing token' }));
            return;
          }
        }

        const acceptsSse = (req.headers.accept || '').includes('text/event-stream');
        const wantsJson = (req.headers.accept || '').includes('application/json');

        // SSE Endpoint (MCP Specification) - supports both /mcp/sse and /mcp
        if (req.method === 'GET' && (parsedUrl.pathname === '/mcp/sse' || (parsedUrl.pathname === '/mcp' && (acceptsSse || !wantsJson)))) {
          const sessionId = crypto.randomBytes(8).toString('hex');
          const hostHeader = req.headers.host || `${this.host}:${this.port}`;

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Mcp-Session-Id': sessionId,
            'mcp-session-id': sessionId,
            'Access-Control-Expose-Headers': 'Mcp-Session-Id, mcp-session-id',
          });

          this.sseSessions.set(sessionId, res);

          // Inform MCP client of message endpoint with full absolute URL
          res.write(`event: endpoint\ndata: http://${hostHeader}/mcp/message?sessionId=${sessionId}\n\n`);

          const heartbeat = setInterval(() => {
            try { res.write(': ping\n\n'); } catch {}
          }, 15000);

          req.on('close', () => {
            clearInterval(heartbeat);
            this.sseSessions.delete(sessionId);
          });
          return;
        }

        // Health / Diagnostic Endpoint (JSON)
        if (req.method === 'GET' && (parsedUrl.pathname === '/health' || (parsedUrl.pathname === '/mcp' && wantsJson))) {
          const cdpAvailable = await this.cdpEngine.isCdpAvailable();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'running',
            name: 'wrave-mcp-server',
            version: '1.3.0',
            securityMode: this.cdpEngine?.securityMode || 'ask_validation',
            cdpConnected: cdpAvailable,
            extensionConnected: !!(this.extensionSocket && this.extensionSocket.readyState === WebSocket.OPEN),
            tools: this.getToolsDefinition().map(t => t.name),
          }));
          return;
        }

        // HTTP JSON-RPC Endpoint (Supports Streamable HTTP, direct POST, and SSE message routing)
        if (req.method === 'POST' && (parsedUrl.pathname === '/mcp' || parsedUrl.pathname === '/mcp/message' || parsedUrl.pathname === '/mcp/sse')) {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', async () => {
            try {
              const msg = JSON.parse(body) as JsonRpcRequest;
              const rpcRes = await this.handleRpcMessage(msg, 'HTTP Client');
              const sessionId = (req.headers['mcp-session-id'] as string) ||
                                (req.headers['x-session-id'] as string) ||
                                parsedUrl.searchParams.get('sessionId') ||
                                (this.sseSessions.size === 1 ? Array.from(this.sseSessions.keys())[0] : null) ||
                                crypto.randomBytes(8).toString('hex');

              const sseRes = sessionId ? this.sseSessions.get(sessionId) : null;

              if (sseRes && rpcRes) {
                try {
                  sseRes.write(`event: message\ndata: ${JSON.stringify(rpcRes)}\n\n`);
                } catch {}
              }

              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Mcp-Session-Id', sessionId);
              res.setHeader('mcp-session-id', sessionId);
              res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, mcp-session-id');

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(rpcRes || { jsonrpc: '2.0', id: null, result: {} }));
            } catch (err: any) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: err.message },
              }));
            }
          });
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });

      this.wss = new WebSocketServer({ noServer: true });

      this.server.on('upgrade', (req, socket, head) => {
        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || this.host}`);
        const wsHost = (req.headers.host || '').toLowerCase();
        if (wsHost && !wsHost.startsWith('127.0.0.1') && !wsHost.startsWith('localhost') && !wsHost.startsWith('::1')) {
          socket.destroy();
          return;
        }

        const wsOrigin = (req.headers.origin || '').toLowerCase();
        if (wsOrigin) {
          const isAllowedWsOrigin =
            wsOrigin.startsWith('chrome-extension://') ||
            wsOrigin.startsWith('moz-extension://') ||
            wsOrigin.startsWith('http://127.0.0.1') ||
            wsOrigin.startsWith('https://127.0.0.1') ||
            wsOrigin.startsWith('http://localhost') ||
            wsOrigin.startsWith('https://localhost');

          if (!isAllowedWsOrigin) {
            socket.destroy();
            return;
          }
        }

        if (parsedUrl.pathname === '/extension') {
          this.wss!.handleUpgrade(req, socket, head, (ws) => {
            this.extensionSocket = ws;
            ws.on('message', (data: any) => {
              try {
                const parsed = JSON.parse(data.toString());
                if (parsed.id && this.pendingBridgeRequests.has(parsed.id)) {
                  const { resolve, reject } = this.pendingBridgeRequests.get(parsed.id)!;
                  this.pendingBridgeRequests.delete(parsed.id);
                  if (parsed.error) reject(new Error(parsed.error));
                  else resolve(parsed.result);
                }
              } catch {}
            });
            ws.on('close', () => {
              if (this.extensionSocket === ws) this.extensionSocket = null;
            });
          });
        } else {
          socket.destroy();
        }
      });

      this.server.listen(this.port, this.host, () => {
        resolve({
          port: this.port,
          host: this.host,
          sseUrl: `http://${this.host}:${this.port}/mcp/sse`,
          token: this.authToken,
        });
      });

      this.server.on('error', reject);
    });
  }

  startBridgeOnly(port = 8282, host = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const hostHeader = (req.headers.host || '').toLowerCase();
        if (hostHeader && !hostHeader.startsWith('127.0.0.1') && !hostHeader.startsWith('localhost') && !hostHeader.startsWith('::1')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden: Invalid Host header' }));
          return;
        }

        const origin = req.headers.origin;
        if (origin) {
          const isAllowedOrigin =
            origin.startsWith('chrome-extension://') ||
            origin.startsWith('moz-extension://') ||
            origin.startsWith('http://127.0.0.1') ||
            origin.startsWith('https://127.0.0.1') ||
            origin.startsWith('http://localhost') ||
            origin.startsWith('https://localhost');

          if (!isAllowedOrigin) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
          }
          res.setHeader('Access-Control-Allow-Origin', origin);
        } else {
          res.setHeader('Access-Control-Allow-Origin', '*');
        }

        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || host}`);
        if (parsedUrl.pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'running', mode: 'stdio-bridge' }));
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      });

      this.wss = new WebSocketServer({ noServer: true });

      this.server.on('upgrade', (req, socket, head) => {
        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || host}`);
        const wsHost = (req.headers.host || '').toLowerCase();
        if (wsHost && !wsHost.startsWith('127.0.0.1') && !wsHost.startsWith('localhost') && !wsHost.startsWith('::1')) {
          socket.destroy();
          return;
        }

        const wsOrigin = (req.headers.origin || '').toLowerCase();
        if (wsOrigin) {
          const isAllowedWsOrigin =
            wsOrigin.startsWith('chrome-extension://') ||
            wsOrigin.startsWith('moz-extension://') ||
            wsOrigin.startsWith('http://127.0.0.1') ||
            wsOrigin.startsWith('https://127.0.0.1') ||
            wsOrigin.startsWith('http://localhost') ||
            wsOrigin.startsWith('https://localhost');

          if (!isAllowedWsOrigin) {
            socket.destroy();
            return;
          }
        }

        if (parsedUrl.pathname === '/extension') {
          this.wss!.handleUpgrade(req, socket, head, (ws) => {
            this.extensionSocket = ws;
            ws.on('message', (data: any) => {
              try {
                const parsed = JSON.parse(data.toString());
                if (parsed.id && this.pendingBridgeRequests.has(parsed.id)) {
                  const { resolve, reject } = this.pendingBridgeRequests.get(parsed.id)!;
                  this.pendingBridgeRequests.delete(parsed.id);
                  if (parsed.error) reject(new Error(parsed.error));
                  else resolve(parsed.result);
                }
              } catch {}
            });
            ws.on('close', () => {
              if (this.extensionSocket === ws) this.extensionSocket = null;
            });
          });
        } else {
          socket.destroy();
        }
      });

      this.server.on('error', () => {
        resolve(false);
      });

      this.server.listen(port, host, () => {
        resolve(true);
      });
    });
  }

  stop(): void {
    if (this.wss) {
      try { this.wss.close(); } catch {}
    }
    if (this.server) {
      try { this.server.close(); } catch {}
    }
    for (const res of this.sseSessions.values()) {
      try { res.end(); } catch {}
    }
    this.sseSessions.clear();
  }
}
