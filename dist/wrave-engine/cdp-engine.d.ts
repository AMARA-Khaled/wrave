/**
 * Wrave High-Speed CDP Automation Engine
 * Connects directly to Chromium / Brave remote debugging protocol (CDP).
 */
import WebSocket from 'ws';
import { CdpOptions, SecurityMode, TabInfo, TabState, ScreenshotResult } from './types.js';
interface CdpSession {
    tabId: string;
    ws: WebSocket;
    messageId: number;
    callbacks: Map<number, {
        resolve: (val: any) => void;
        reject: (err: any) => void;
    }>;
    consoleLogs: Array<{
        type: string;
        args: any[];
        timestamp: number;
    }>;
}
export declare class WraveCdpEngine {
    cdpHost: string;
    cdpPort: number;
    securityMode: SecurityMode;
    alwaysAllowedDomains: Set<string>;
    private sessions;
    private _cdpAvailableCache;
    private _cdpCacheTime;
    constructor(options?: CdpOptions);
    get cdpBaseUrl(): string;
    isCdpAvailable(): Promise<boolean>;
    getVersionInfo(): Promise<any>;
    listTabs(): Promise<TabInfo[]>;
    openTab(url?: string, activate?: boolean): Promise<any>;
    closeTab(tabId: string): Promise<any>;
    focusTab(tabId: string): Promise<any>;
    reloadTab(tabId: string, ignoreCache?: boolean): Promise<any>;
    ensureSession(tabId: string): Promise<CdpSession>;
    sendCdpCommand(tabId: string, method: string, params?: Record<string, any>): Promise<any>;
    validateAction(tabId: string, actionType: string, details?: Record<string, any>): Promise<boolean>;
    getTabState(tabId: string): Promise<TabState>;
    getDomTree(tabId: string, maxDepth?: number): Promise<any>;
    getAccessibilityTree(tabId: string): Promise<any>;
    takeScreenshot(tabId: string, format?: string, quality?: number, fullPage?: boolean): Promise<ScreenshotResult>;
    click(tabId: string, target: string | {
        x: number;
        y: number;
    }, button?: string, clickCount?: number): Promise<any>;
    doubleClick(tabId: string, target: string | {
        x: number;
        y: number;
    }): Promise<any>;
    typeText(tabId: string, selector: string, text: string, clearFirst?: boolean): Promise<any>;
    pressKey(tabId: string, key: string): Promise<any>;
    scrollPage(tabId: string, deltaX?: number, deltaY?: number): Promise<any>;
    executeScript(tabId: string, expression: string): Promise<any>;
    getCookies(tabId: string): Promise<any>;
    printToPdf(tabId: string): Promise<any>;
    getConsoleLogs(tabId: string): Promise<any[]>;
}
export {};
//# sourceMappingURL=cdp-engine.d.ts.map