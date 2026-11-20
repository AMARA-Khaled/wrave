/**
 * Wrave High-Speed CDP Automation Engine
 * Connects directly to Chromium / Brave remote debugging protocol (CDP).
 */
import WebSocket from 'ws';
import { CdpOptions, SecurityMode, TabInfo, TabState, ScreenshotResult } from './types.js';
type LoadPhase = 'loading' | 'interactive' | 'complete';
interface CdpSession {
    tabId: string;
    ws: WebSocket;
    messageId: number;
    callbacks: Map<number, {
        resolve: (val: any) => void;
        reject: (err: any) => void;
        timer: NodeJS.Timeout;
    }>;
    consoleLogs: Array<{
        type: string;
        args: any[];
        timestamp: number;
    }>;
    mainFrameId: string | null;
    phase: LoadPhase;
    axEnabled: boolean;
    /** In-flight requests that usually precede a UI update (document / XHR / fetch / script). */
    inflight: Map<string, number>;
}
export interface SnapshotOptions {
    maxElements?: number;
    viewportOnly?: boolean;
    dismissDialogs?: boolean;
}
export interface IdleOptions {
    /** Max time to wait for an in-flight navigation to reach DOMContentLoaded. */
    loadTimeoutMs?: number;
    /** DOM must be mutation-free for this long. */
    quietMs?: number;
    /** Upper bound on the DOM-settle wait. */
    settleMaxMs?: number;
}
export interface FormField {
    selector: string;
    value: string | number | boolean;
}
export declare class WraveCdpEngine {
    cdpHost: string;
    cdpPort: number;
    securityMode: SecurityMode;
    alwaysAllowedDomains: Set<string>;
    private sessions;
    private pendingSessions;
    private _cdpAvailableCache;
    private _cdpCacheTime;
    constructor(options?: CdpOptions);
    get cdpBaseUrl(): string;
    /**
     * Positive results are cached for 10s, negative ones for only 1s so a freshly
     * launched browser is picked up almost immediately.
     */
    isCdpAvailable(): Promise<boolean>;
    invalidateAvailability(): void;
    getVersionInfo(): Promise<any>;
    listTabs(): Promise<TabInfo[]>;
    openTab(url?: string, activate?: boolean, wait?: boolean): Promise<{
        id: string;
        url: string;
        title: string;
        status: string;
    }>;
    closeTab(tabId: string): Promise<any>;
    focusTab(tabId: string): Promise<any>;
    reloadTab(tabId: string, ignoreCache?: boolean): Promise<any>;
    ensureSession(tabId: string): Promise<CdpSession>;
    private createSession;
    private handleEvent;
    private rawSend;
    sendCdpCommand(tabId: string, method: string, params?: Record<string, any>, timeoutMs?: number): Promise<any>;
    hasLiveSession(tabId: string): boolean;
    private dropSession;
    /** Runtime.evaluate returning the value by value; page exceptions become thrown errors. */
    evaluate(tabId: string, expression: string, awaitPromise?: boolean, timeoutMs?: number): Promise<any>;
    /** Polls document.readyState (works for tabs whose load started before we attached). */
    waitForReadyState(tabId: string, timeoutMs?: number, skipInitialBlank?: boolean): Promise<boolean>;
    /** Resolves after the DOM has been quiet for quietMs (capped at maxMs). Survives navigations. */
    settle(tabId: string, quietMs?: number, maxMs?: number): Promise<void>;
    /**
     * Wait for the page to become usable after an action: any navigation the action triggered
     * reaches DOMContentLoaded, then the DOM stops changing. Replaces fixed sleeps.
     */
    /** Count of tracked requests in flight, ignoring long-lived ones (>10s: streaming / long-polling). */
    private pendingRequests;
    waitForIdle(tabId: string, opts?: IdleOptions): Promise<{
        waitedMs: number;
        stillLoading?: boolean;
    }>;
    waitFor(tabId: string, opts: {
        selector?: string;
        text?: string;
        gone?: boolean;
        timeoutMs?: number;
    }): Promise<any>;
    navigate(tabId: string, url: string, timeoutMs?: number): Promise<any>;
    goHistory(tabId: string, delta: -1 | 1, timeoutMs?: number): Promise<any>;
    validateAction(tabId: string, actionType: string, details?: Record<string, any>): Promise<boolean>;
    getTabState(tabId: string): Promise<TabState>;
    getDomTree(tabId: string, maxDepth?: number): Promise<any>;
    /** Compact accessibility outline: one line per meaningful node, indented by depth. */
    getAccessibilityTree(tabId: string, maxNodes?: number): Promise<string>;
    takeScreenshot(tabId: string, format?: string, quality?: number, fullPage?: boolean): Promise<ScreenshotResult>;
    /** Resolve a selector / @ref / text: target, scroll it into view, and return its center point. */
    private locate;
    click(tabId: string, target: string | {
        x: number;
        y: number;
    }, button?: string, clickCount?: number): Promise<any>;
    doubleClick(tabId: string, target: string | {
        x: number;
        y: number;
    }): Promise<any>;
    hover(tabId: string, target: string | {
        x: number;
        y: number;
    }): Promise<any>;
    /**
     * Types text in a single Input.insertText call (fires real beforeinput/input events,
     * works with React/Vue/contenteditable). Previously ~22ms per character, now constant time.
     */
    typeText(tabId: string, selector: string | undefined, text: string, clearFirst?: boolean): Promise<any>;
    typeAndSubmit(tabId: string, selector: string, text: string, clearFirst?: boolean, submitKey?: string): Promise<any>;
    clickAndRead(tabId: string, target: string | {
        x: number;
        y: number;
    }, snapOpts?: SnapshotOptions): Promise<any>;
    getSnapshot(tabId: string, opts?: SnapshotOptions): Promise<any>;
    getText(tabId: string, selector?: string, maxChars?: number): Promise<any>;
    selectOption(tabId: string, selector: string, value: string): Promise<any>;
    /** Fill many fields in one call. Text inputs are replaced, selects matched by value/label, checkboxes set to the given boolean. */
    fillForm(tabId: string, fields: FormField[], submit?: string): Promise<any>;
    /**
     * Press a key or combination: "Enter", "Tab", "ArrowDown", "a", "Control+a", "Shift+Tab", "Meta+Enter".
     */
    pressKey(tabId: string, combo: string): Promise<any>;
    scrollPage(tabId: string, opts?: {
        deltaX?: number;
        deltaY?: number;
        selector?: string;
        to?: 'top' | 'bottom';
    }): Promise<any>;
    executeScript(tabId: string, expression: string): Promise<any>;
    getCookies(tabId: string): Promise<any>;
    printToPdf(tabId: string): Promise<any>;
    getConsoleLogs(tabId: string, clear?: boolean): Promise<any[]>;
}
/** Accepts "example.com" or "localhost:3000/x" and adds a scheme. */
export declare function normalizeUrl(url: string): string;
export {};
//# sourceMappingURL=cdp-engine.d.ts.map