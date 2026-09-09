/**
 * Wrave Model Context Protocol (MCP) TypeScript Type Definitions
 */
export type SecurityMode = 'ask_validation' | 'full_access' | 'restricted';
export interface CdpOptions {
    host?: string;
    port?: number;
    securityMode?: SecurityMode;
}
export interface McpServerOptions {
    port?: number;
    host?: string;
    authToken?: string;
    requireAuth?: boolean;
    cdpOptions?: CdpOptions;
}
export interface McpToolProperty {
    type: string;
    description?: string;
    enum?: string[];
    default?: string | number | boolean;
    items?: Record<string, unknown>;
}
export interface McpToolSchema {
    type: 'object';
    properties: Record<string, McpToolProperty>;
    required?: string[];
}
export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: McpToolSchema;
}
export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: Record<string, unknown>;
}
export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}
export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id?: string | number | null;
    result?: unknown;
    error?: JsonRpcError;
}
export interface McpToolResultContent {
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mimeType?: string;
}
export interface McpToolCallResult {
    content: McpToolResultContent[];
    isError?: boolean;
}
export interface TabInfo {
    id: string | number;
    index?: number;
    title: string;
    url: string;
    active?: boolean;
    status?: string;
}
export interface TabState {
    id: string | number;
    title: string;
    url: string;
    active: boolean;
    status: string;
    width?: number;
    height?: number;
    scrollX?: number;
    scrollY?: number;
}
export interface ScreenshotResult {
    _isImage?: boolean;
    format?: string;
    mimeType?: string;
    data?: string;
    dataBase64?: string;
}
export interface BridgeMessage {
    id: number;
    method: string;
    params?: Record<string, unknown>;
}
export interface BridgeReply {
    id: number;
    result?: unknown;
    error?: string;
}
//# sourceMappingURL=types.d.ts.map