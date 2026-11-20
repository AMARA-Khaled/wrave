/**
 * MCP tool catalogue and result formatting for Wrave.
 * Descriptions are written for the calling model: they steer it toward the
 * fewest-round-trip workflow (snapshot -> act by @ref -> batch).
 */
import { McpToolDefinition } from './types.js';
export declare const SERVER_INSTRUCTIONS = "Wrave drives the user's real Brave browser.\nFast workflow:\n1. wrave_open_tab or wrave_navigate return a page snapshot: interactive elements are listed as @1, @2, ...\n2. Act on elements by @ref (or a CSS selector, or text:Visible Label). Refs are renumbered on every snapshot, so use refs from the latest one.\n3. tab_id is optional everywhere: it defaults to the tab you last opened or used.\n4. Chain several steps in ONE call with wrave_batch (e.g. fill fields, click, wait_for, get_text). Use wrave_fill_form for forms.\n5. Prefer wrave_get_text / wrave_get_snapshot over screenshots: much faster and cheaper. Use wrave_take_screenshot only for visual questions.\n6. Actions wait for the page to settle automatically, so you rarely need wrave_wait_for. Use it for slow async content (wait_for text \"...\" ).";
export declare function getToolsDefinition(): McpToolDefinition[];
/** Renders a snapshot as compact text: one line per element (~5x fewer tokens than pretty JSON). */
export declare function formatSnapshot(s: any, includeBoxes?: boolean): string;
//# sourceMappingURL=tool-definitions.d.ts.map