/**
 * Wrave Model Context Protocol (MCP) Server (TypeScript)
 * Exposes Wrave browser automation to AI harnesses (Claude Code, Antigravity, Codex, OpenCode).
 * Supports SSE, Stdio, and HTTP POST JSON-RPC 2.0 with Bearer token authentication.
 * Includes Extension WebSocket bridge for fallback automation when CDP is not enabled.
 */
import WebSocket from 'ws';
import { WraveCdpEngine } from './cdp-engine.js';
import { McpServerOptions, McpToolDefinition, JsonRpcRequest, JsonRpcResponse } from './types.js';
export declare class WraveMcpServer {
    port: number;
    host: string;
    authToken: string;
    requireAuth: boolean;
    cdpEngine: WraveCdpEngine;
    private sseSessions;
    private server;
    private wss;
    extensionSocket: WebSocket | null;
    private pendingBridgeRequests;
    private bridgeMessageId;
    constructor(options?: McpServerOptions);
    getToolsDefinition(): McpToolDefinition[];
    sendBridgeCommand(method: string, params?: Record<string, any>, timeoutMs?: number): Promise<any>;
    handleMcpToolCall(name: string, args?: Record<string, any>, _callerName?: string): Promise<any>;
    handleRpcMessage(msg: JsonRpcRequest, callerName?: string): Promise<JsonRpcResponse | null>;
    start(): Promise<{
        port: number;
        host: string;
        sseUrl: string;
        token: string;
    }>;
    startBridgeOnly(port?: number, host?: string): Promise<boolean>;
    stop(): void;
}
//# sourceMappingURL=mcp-server.d.ts.map