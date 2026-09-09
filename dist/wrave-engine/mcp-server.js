/**
 * Wrave Model Context Protocol (MCP) Server (TypeScript)
 * Exposes Wrave browser automation to AI harnesses (Claude Code, Antigravity, Codex, OpenCode).
 * Supports SSE, Stdio, and HTTP POST JSON-RPC 2.0 with Bearer token authentication.
 * Includes Extension WebSocket bridge for fallback automation when CDP is not enabled.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';
import { WraveCdpEngine } from './cdp-engine.js';
export class WraveMcpServer {
    port;
    host;
    authToken;
    requireAuth;
    cdpEngine;
    sseSessions;
    server = null;
    wss = null;
    extensionSocket = null;
    pendingBridgeRequests;
    bridgeMessageId = 1;
    constructor(options = {}) {
        this.port = options.port || 8282;
        this.host = options.host || '127.0.0.1';
        this.authToken = options.authToken || crypto.randomBytes(16).toString('hex');
        this.requireAuth = options.requireAuth ?? false;
        this.cdpEngine = new WraveCdpEngine(options.cdpOptions || {});
        this.sseSessions = new Map();
        this.pendingBridgeRequests = new Map();
    }
    getToolsDefinition() {
        return [
            {
                name: 'wrave_list_tabs',
                description: 'List all open tabs in Brave, including tab ID, URL, title, and active state.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'wrave_open_tab',
                description: 'Open a new tab with the specified URL.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: 'URL to open' },
                        activate: { type: 'boolean', default: true, description: 'Bring tab to foreground' },
                    },
                    required: ['url'],
                },
            },
            {
                name: 'wrave_close_tab',
                description: 'Close an open tab by its ID.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab to close' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_focus_tab',
                description: 'Bring a tab to the foreground and activate it.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab to focus' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_reload_tab',
                description: 'Reload the specified tab.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab to reload' },
                        ignore_cache: { type: 'boolean', default: false },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_get_tab_state',
                description: 'Read the active tab state including title, URL, viewport dimensions, and scroll offset.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_get_dom_tree',
                description: 'Extract clean, LLM-friendly DOM tree with bounding boxes [x, y, w, h] and interactive element metadata.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                        max_depth: { type: 'number', default: 4, description: 'Max tree nesting depth' },
                        html: { type: 'boolean', default: false, description: 'Return full HTML if true' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_get_accessibility_tree',
                description: 'Extract the full accessibility tree (AXTree) for semantic screen-reader level inspection.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_take_screenshot',
                description: 'Capture a screenshot of the tab viewport or full page as base64 PNG/JPEG.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                        full_page: { type: 'boolean', default: false },
                        format: { type: 'string', enum: ['png', 'jpeg'], default: 'png' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_click',
                description: 'Dispatch mouse click to element selector or pixel coordinates.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                        selector: { type: 'string', description: 'CSS selector of the target element' },
                        x: { type: 'number', description: 'Optional explicit X coordinate' },
                        y: { type: 'number', description: 'Optional explicit Y coordinate' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_double_click',
                description: 'Dispatch double-click event to element selector or coordinates.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                        selector: { type: 'string', description: 'CSS selector of the target element' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_type_text',
                description: 'Type text into an input or textarea.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                        selector: { type: 'string', description: 'CSS selector of the input element' },
                        text: { type: 'string', description: 'Text string to type' },
                        clear_first: { type: 'boolean', default: false, description: 'Clear existing text first' },
                    },
                    required: ['tab_id', 'text'],
                },
            },
            {
                name: 'wrave_press_key',
                description: 'Send a keyboard key press (e.g. Enter, Escape, Tab, Backspace).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                        key: { type: 'string', description: 'Key name (Enter, Tab, Escape, etc.)' },
                    },
                    required: ['tab_id', 'key'],
                },
            },
            {
                name: 'wrave_scroll_page',
                description: 'Scroll the active tab viewport by deltaX and deltaY.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                        delta_y: { type: 'number', default: 300, description: 'Vertical scroll amount' },
                        delta_x: { type: 'number', default: 0, description: 'Horizontal scroll amount' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_execute_script',
                description: 'Execute arbitrary JavaScript expression in the tab context.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                        script: { type: 'string', description: 'JavaScript code to evaluate' },
                    },
                    required: ['tab_id', 'script'],
                },
            },
            {
                name: 'wrave_get_cookies',
                description: 'Retrieve cookies for the tab or domain.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_print_to_pdf',
                description: 'Export the current page as a PDF document.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_get_console_logs',
                description: 'Retrieve intercepted console logs for the tab.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_get_snapshot',
                description: 'Instant page snapshot with indexed interactive elements (@1, @2, etc.), title, and URL.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_click_and_read',
                description: 'Click an element (by selector, @ref like @1, or x/y) and immediately return the updated page snapshot in 1 turn.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                        selector: { type: 'string', description: 'CSS selector or @ref (e.g. @1, @4) to click' },
                        x: { type: 'number', description: 'Optional explicit X coordinate' },
                        y: { type: 'number', description: 'Optional explicit Y coordinate' },
                    },
                    required: ['tab_id'],
                },
            },
            {
                name: 'wrave_type_and_submit',
                description: 'Type text into an input or contenteditable field and submit with Enter key in 1 turn.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tab_id: { type: 'string', description: 'The ID of the tab' },
                        selector: { type: 'string', description: 'CSS selector or @ref (e.g. @1, @2) of the input element' },
                        text: { type: 'string', description: 'The text to type' },
                        clear_first: { type: 'boolean', default: false, description: 'Clear existing text before typing' },
                        submit_key: { type: 'string', default: 'Enter', description: 'Key to send after typing (default Enter)' },
                    },
                    required: ['tab_id', 'selector', 'text'],
                },
            },
        ];
    }
    async sendBridgeCommand(method, params = {}, timeoutMs = 8000) {
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
            this.extensionSocket.send(JSON.stringify({ id, method, params }));
        });
    }
    async handleMcpToolCall(name, args = {}, _callerName = 'AI Harness') {
        const cdpReady = await this.cdpEngine.isCdpAvailable();
        // 1. Direct CDP Execution (Primary)
        if (cdpReady) {
            switch (name) {
                case 'wrave_list_tabs':
                    return await this.cdpEngine.listTabs();
                case 'wrave_open_tab':
                    return await this.cdpEngine.openTab(args.url, args.activate !== false);
                case 'wrave_close_tab':
                    return await this.cdpEngine.closeTab(args.tab_id);
                case 'wrave_focus_tab':
                    return await this.cdpEngine.focusTab(args.tab_id);
                case 'wrave_reload_tab':
                    return await this.cdpEngine.reloadTab(args.tab_id, args.ignore_cache);
                case 'wrave_get_tab_state':
                    return await this.cdpEngine.getTabState(args.tab_id);
                case 'wrave_get_dom_tree':
                    return await this.cdpEngine.getDomTree(args.tab_id, args.max_depth || 4);
                case 'wrave_get_accessibility_tree':
                    return await this.cdpEngine.getAccessibilityTree(args.tab_id);
                case 'wrave_take_screenshot': {
                    const shot = await this.cdpEngine.takeScreenshot(args.tab_id, args.format || 'png', 80, args.full_page || false);
                    return {
                        _isImage: true,
                        mimeType: `image/${shot.format}`,
                        data: shot.dataBase64,
                    };
                }
                case 'wrave_click': {
                    const target = (args.x !== undefined && args.y !== undefined) ? { x: args.x, y: args.y } : args.selector;
                    return await this.cdpEngine.click(args.tab_id, target);
                }
                case 'wrave_double_click':
                    return await this.cdpEngine.doubleClick(args.tab_id, args.selector);
                case 'wrave_type_text':
                    return await this.cdpEngine.typeText(args.tab_id, args.selector, args.text, args.clear_first);
                case 'wrave_press_key':
                    return await this.cdpEngine.pressKey(args.tab_id, args.key);
                case 'wrave_scroll_page':
                    return await this.cdpEngine.scrollPage(args.tab_id, args.delta_x || 0, args.delta_y || 300);
                case 'wrave_execute_script':
                    return await this.cdpEngine.executeScript(args.tab_id, args.script);
                case 'wrave_get_cookies':
                    return await this.cdpEngine.getCookies(args.tab_id);
                case 'wrave_print_to_pdf':
                    return await this.cdpEngine.printToPdf(args.tab_id);
                case 'wrave_get_console_logs':
                    return await this.cdpEngine.getConsoleLogs(args.tab_id);
                case 'wrave_get_snapshot':
                    return await this.cdpEngine.getSnapshot(args.tab_id);
                case 'wrave_click_and_read': {
                    const target = (args.x !== undefined && args.y !== undefined) ? { x: args.x, y: args.y } : args.selector;
                    return await this.cdpEngine.clickAndRead(args.tab_id, target);
                }
                case 'wrave_type_and_submit':
                    return await this.cdpEngine.typeAndSubmit(args.tab_id, args.selector, args.text, args.clear_first, args.submit_key || 'Enter');
            }
        }
        // 2. Extension Bridge Fallback (When CDP port 9222 is not active)
        if (this.extensionSocket && this.extensionSocket.readyState === WebSocket.OPEN) {
            switch (name) {
                case 'wrave_list_tabs':
                    return await this.sendBridgeCommand('tabs_list');
                case 'wrave_open_tab':
                    return await this.sendBridgeCommand('tab_create', { url: args.url, active: args.activate !== false });
                case 'wrave_close_tab':
                    return await this.sendBridgeCommand('tab_close', { tabId: args.tab_id });
                case 'wrave_focus_tab':
                    return await this.sendBridgeCommand('tab_activate', { tabId: args.tab_id });
                case 'wrave_reload_tab':
                    return await this.sendBridgeCommand('tab_reload', { tabId: args.tab_id, ignore_cache: args.ignore_cache });
                case 'wrave_get_tab_state':
                    return await this.sendBridgeCommand('tab_get_state', { tabId: args.tab_id });
                case 'wrave_take_screenshot': {
                    const shot = await this.sendBridgeCommand('page_screenshot', { tabId: args.tab_id, format: args.format || 'png' });
                    const dataBase64 = shot.dataUrl ? shot.dataUrl.replace(/^data:image\/\w+;base64,/, '') : (shot.dataBase64 || '');
                    return {
                        _isImage: true,
                        mimeType: `image/${args.format || 'png'}`,
                        data: dataBase64,
                    };
                }
                case 'wrave_get_dom_tree':
                    return await this.sendBridgeCommand('page_get_dom', { tabId: args.tab_id, html: !!args.html });
                case 'wrave_get_snapshot':
                    return await this.sendBridgeCommand('page_get_snapshot', { tabId: args.tab_id });
                case 'wrave_click':
                    return await this.sendBridgeCommand('page_click', { tabId: args.tab_id, selector: args.selector || '', x: args.x, y: args.y });
                case 'wrave_click_and_read':
                    return await this.sendBridgeCommand('page_click_and_read', { tabId: args.tab_id, selector: args.selector || '', x: args.x, y: args.y });
                case 'wrave_type_text':
                    return await this.sendBridgeCommand('page_type_text', { tabId: args.tab_id, selector: args.selector || '', text: args.text || '', clear_first: !!args.clear_first });
                case 'wrave_type_and_submit':
                    return await this.sendBridgeCommand('page_type_and_submit', { tabId: args.tab_id, selector: args.selector || '', text: args.text || '', clear_first: !!args.clear_first, submit_key: args.submit_key || 'Enter' });
                case 'wrave_press_key':
                    return await this.sendBridgeCommand('page_press_key', { tabId: args.tab_id, key: args.key });
                case 'wrave_scroll_page':
                    return await this.sendBridgeCommand('page_scroll', { tabId: args.tab_id, deltaX: args.delta_x || 0, deltaY: args.delta_y || 300 });
                case 'wrave_execute_script':
                    return await this.sendBridgeCommand('page_execute_js', { tabId: args.tab_id, script: args.script });
                case 'wrave_get_cookies':
                    return await this.sendBridgeCommand('page_get_cookies', { tabId: args.tab_id });
                default:
                    throw new Error(`Tool "${name}" requires Chrome DevTools Protocol. Launch Brave with --remote-debugging-port=9222 for full tool access.`);
            }
        }
        throw new Error('Brave is not connected. Either start Brave with --remote-debugging-port=9222 or open Brave with the Wrave Extension loaded.');
    }
    async handleRpcMessage(msg, callerName = 'AI Harness') {
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
                        version: '1.2.0',
                    },
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
            const toolName = params.name;
            const toolArgs = (params.arguments || {});
            try {
                const toolResult = await this.handleMcpToolCall(toolName, toolArgs, callerName);
                const content = [];
                if (toolResult && toolResult._isImage) {
                    content.push({
                        type: 'image',
                        data: toolResult.data,
                        mimeType: toolResult.mimeType || 'image/png',
                    });
                }
                else {
                    content.push({
                        type: 'text',
                        text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2),
                    });
                }
                return {
                    jsonrpc: '2.0',
                    id,
                    result: { content, isError: false },
                };
            }
            catch (err) {
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
    start() {
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
                    const isAllowedOrigin = origin.startsWith('chrome-extension://') ||
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
                }
                else {
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
                        try {
                            res.write(': ping\n\n');
                        }
                        catch { }
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
                        version: '1.2.0',
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
                            const msg = JSON.parse(body);
                            const rpcRes = await this.handleRpcMessage(msg, 'HTTP Client');
                            const sessionId = req.headers['mcp-session-id'] ||
                                req.headers['x-session-id'] ||
                                parsedUrl.searchParams.get('sessionId') ||
                                (this.sseSessions.size === 1 ? Array.from(this.sseSessions.keys())[0] : null) ||
                                crypto.randomBytes(8).toString('hex');
                            const sseRes = sessionId ? this.sseSessions.get(sessionId) : null;
                            if (sseRes && rpcRes) {
                                try {
                                    sseRes.write(`event: message\ndata: ${JSON.stringify(rpcRes)}\n\n`);
                                }
                                catch { }
                            }
                            res.setHeader('Access-Control-Allow-Origin', '*');
                            res.setHeader('Mcp-Session-Id', sessionId);
                            res.setHeader('mcp-session-id', sessionId);
                            res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, mcp-session-id');
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(rpcRes || { jsonrpc: '2.0', id: null, result: {} }));
                        }
                        catch (err) {
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
                    const isAllowedWsOrigin = wsOrigin.startsWith('chrome-extension://') ||
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
                    this.wss.handleUpgrade(req, socket, head, (ws) => {
                        this.extensionSocket = ws;
                        ws.on('message', (data) => {
                            try {
                                const parsed = JSON.parse(data.toString());
                                if (parsed.id && this.pendingBridgeRequests.has(parsed.id)) {
                                    const { resolve, reject } = this.pendingBridgeRequests.get(parsed.id);
                                    this.pendingBridgeRequests.delete(parsed.id);
                                    if (parsed.error)
                                        reject(new Error(parsed.error));
                                    else
                                        resolve(parsed.result);
                                }
                            }
                            catch { }
                        });
                        ws.on('close', () => {
                            if (this.extensionSocket === ws)
                                this.extensionSocket = null;
                        });
                    });
                }
                else {
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
    startBridgeOnly(port = 8282, host = '127.0.0.1') {
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
                    const isAllowedOrigin = origin.startsWith('chrome-extension://') ||
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
                }
                else {
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
                    const isAllowedWsOrigin = wsOrigin.startsWith('chrome-extension://') ||
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
                    this.wss.handleUpgrade(req, socket, head, (ws) => {
                        this.extensionSocket = ws;
                        ws.on('message', (data) => {
                            try {
                                const parsed = JSON.parse(data.toString());
                                if (parsed.id && this.pendingBridgeRequests.has(parsed.id)) {
                                    const { resolve, reject } = this.pendingBridgeRequests.get(parsed.id);
                                    this.pendingBridgeRequests.delete(parsed.id);
                                    if (parsed.error)
                                        reject(new Error(parsed.error));
                                    else
                                        resolve(parsed.result);
                                }
                            }
                            catch { }
                        });
                        ws.on('close', () => {
                            if (this.extensionSocket === ws)
                                this.extensionSocket = null;
                        });
                    });
                }
                else {
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
    stop() {
        if (this.wss) {
            try {
                this.wss.close();
            }
            catch { }
        }
        if (this.server) {
            try {
                this.server.close();
            }
            catch { }
        }
        for (const res of this.sseSessions.values()) {
            try {
                res.end();
            }
            catch { }
        }
        this.sseSessions.clear();
    }
}
//# sourceMappingURL=mcp-server.js.map