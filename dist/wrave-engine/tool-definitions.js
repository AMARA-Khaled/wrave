/**
 * MCP tool catalogue and result formatting for Wrave.
 * Descriptions are written for the calling model: they steer it toward the
 * fewest-round-trip workflow (snapshot -> act by @ref -> batch).
 */
export const SERVER_INSTRUCTIONS = `Wrave drives the user's real Brave browser.
Fast workflow:
1. wrave_open_tab or wrave_navigate return a page snapshot: interactive elements are listed as @1, @2, ...
2. Act on elements by @ref (or a CSS selector, or text:Visible Label). Refs are renumbered on every snapshot, so use refs from the latest one.
3. tab_id is optional everywhere: it defaults to the tab you last opened or used.
4. Chain several steps in ONE call with wrave_batch (e.g. fill fields, click, wait_for, get_text). Use wrave_fill_form for forms.
5. Prefer wrave_get_text / wrave_get_snapshot over screenshots: much faster and cheaper. Use wrave_take_screenshot only for visual questions.
6. Actions wait for the page to settle automatically, so you rarely need wrave_wait_for. Use it for slow async content (wait_for text "..." ).`;
const TAB = { type: 'string', description: 'Tab ID. Optional: defaults to the last tab you opened or used.' };
const SELECTOR = { type: 'string', description: 'Target: @ref from the latest snapshot (e.g. "@3"), a CSS selector, or "text:Visible label".' };
const SNAPSHOT_PROPS = {
    max_elements: { type: 'number', default: 80, description: 'Maximum interactive elements to list.' },
    viewport_only: { type: 'boolean', default: false, description: 'Only list elements currently on screen.' },
};
export function getToolsDefinition() {
    return [
        // --- Tabs & navigation ---
        {
            name: 'wrave_list_tabs',
            description: 'List open tabs (id, title, url).',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'wrave_open_tab',
            description: 'Open a URL in a new tab, wait for it to load, and return its id plus a snapshot of interactive elements (@refs). The new tab becomes the default tab.',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to open ("example.com" is fine, https:// is added).' },
                    activate: { type: 'boolean', default: true, description: 'Bring tab to foreground.' },
                    snapshot: { type: 'boolean', default: true, description: 'Include a page snapshot in the result.' },
                    ...SNAPSHOT_PROPS,
                },
                required: ['url'],
            },
        },
        {
            name: 'wrave_navigate',
            description: 'Navigate the tab to a URL, or go back/forward, wait for load, and return a fresh snapshot. Faster than opening a new tab.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    url: { type: 'string', description: 'URL to load. Omit when using action.' },
                    action: { type: 'string', enum: ['back', 'forward', 'reload'], description: 'History action instead of a URL.' },
                    snapshot: { type: 'boolean', default: true, description: 'Include a page snapshot in the result.' },
                    timeout_ms: { type: 'number', default: 15000, description: 'Max time to wait for the page to load.' },
                    ...SNAPSHOT_PROPS,
                },
            },
        },
        {
            name: 'wrave_close_tab',
            description: 'Close a tab by its ID.',
            inputSchema: { type: 'object', properties: { tab_id: { type: 'string', description: 'The ID of the tab to close' } }, required: ['tab_id'] },
        },
        {
            name: 'wrave_focus_tab',
            description: 'Bring a tab to the foreground and make it the default tab.',
            inputSchema: { type: 'object', properties: { tab_id: { type: 'string', description: 'The ID of the tab to focus' } }, required: ['tab_id'] },
        },
        {
            name: 'wrave_reload_tab',
            description: 'Reload the tab and wait for it to load.',
            inputSchema: { type: 'object', properties: { tab_id: TAB, ignore_cache: { type: 'boolean', default: false } } },
        },
        // --- Reading the page ---
        {
            name: 'wrave_get_snapshot',
            description: 'Compact list of the page\'s visible interactive elements with @refs (buttons, links, inputs with values, selects with options, checkbox state), plus title, URL and scroll position. The main way to "see" a page.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    ...SNAPSHOT_PROPS,
                    include_boxes: { type: 'boolean', default: false, description: 'Include [x,y,w,h] boxes (only needed for coordinate clicks).' },
                    dismiss_popups: { type: 'boolean', default: true, description: 'Auto-close obvious cookie/"not now" dialogs first.' },
                },
            },
        },
        {
            name: 'wrave_get_text',
            description: 'Readable text content of the page (or one element). Use to read articles, results, prices, messages, etc.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    selector: { type: 'string', description: 'Optional element to read (CSS, @ref, or text:Label). Default: whole page.' },
                    max_chars: { type: 'number', default: 8000, description: 'Truncate after this many characters.' },
                },
            },
        },
        {
            name: 'wrave_get_tab_state',
            description: 'Title, URL, load state, viewport size and scroll position.',
            inputSchema: { type: 'object', properties: { tab_id: TAB } },
        },
        {
            name: 'wrave_get_dom_tree',
            description: 'Nested DOM tree with bounding boxes. Verbose: prefer wrave_get_snapshot or wrave_get_text.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    max_depth: { type: 'number', default: 4, description: 'Max tree nesting depth' },
                    html: { type: 'boolean', default: false, description: 'Extension mode only: return full HTML' },
                },
            },
        },
        {
            name: 'wrave_get_accessibility_tree',
            description: 'Compact accessibility outline (role "name" per line, indented). Good for understanding page structure.',
            inputSchema: { type: 'object', properties: { tab_id: TAB, max_nodes: { type: 'number', default: 400 } } },
        },
        {
            name: 'wrave_take_screenshot',
            description: 'Screenshot of the viewport or full page. Slower and more expensive than text tools; use for visual checks.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    full_page: { type: 'boolean', default: false },
                    format: { type: 'string', enum: ['png', 'jpeg'], default: 'jpeg' },
                    quality: { type: 'number', default: 70, description: 'JPEG quality 1-100' },
                },
            },
        },
        // --- Interaction ---
        {
            name: 'wrave_click',
            description: 'Click an element (scrolled into view automatically) or x/y coordinates. Waits for any resulting navigation/DOM update. Set snapshot=true to get the updated page back.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    selector: SELECTOR,
                    x: { type: 'number', description: 'X coordinate (instead of selector)' },
                    y: { type: 'number', description: 'Y coordinate (instead of selector)' },
                    snapshot: { type: 'boolean', default: false, description: 'Return a fresh snapshot after the click.' },
                },
            },
        },
        {
            name: 'wrave_click_and_read',
            description: 'Click, wait for the page to settle, and return the updated snapshot in one call.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    selector: SELECTOR,
                    x: { type: 'number', description: 'Optional explicit X coordinate' },
                    y: { type: 'number', description: 'Optional explicit Y coordinate' },
                    ...SNAPSHOT_PROPS,
                },
            },
        },
        {
            name: 'wrave_double_click',
            description: 'Double-click an element or coordinates.',
            inputSchema: {
                type: 'object',
                properties: { tab_id: TAB, selector: SELECTOR, x: { type: 'number' }, y: { type: 'number' } },
            },
        },
        {
            name: 'wrave_hover',
            description: 'Move the mouse over an element (opens hover menus / tooltips).',
            inputSchema: { type: 'object', properties: { tab_id: TAB, selector: SELECTOR }, required: ['selector'] },
        },
        {
            name: 'wrave_type_text',
            description: 'Type text into an input, textarea or contenteditable (instant, fires real input events). Without selector, types into the focused element.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    selector: SELECTOR,
                    text: { type: 'string', description: 'Text to type' },
                    clear_first: { type: 'boolean', default: false, description: 'Replace existing content instead of appending.' },
                },
                required: ['text'],
            },
        },
        {
            name: 'wrave_type_and_submit',
            description: 'Type into a field, press Enter (or submit_key), and wait for the result to load. Ideal for search boxes.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    selector: SELECTOR,
                    text: { type: 'string', description: 'The text to type' },
                    clear_first: { type: 'boolean', default: true, description: 'Replace existing content first.' },
                    submit_key: { type: 'string', default: 'Enter', description: 'Key to send after typing' },
                    snapshot: { type: 'boolean', default: false, description: 'Return a fresh snapshot after submitting.' },
                },
                required: ['selector', 'text'],
            },
        },
        {
            name: 'wrave_press_key',
            description: 'Press a key or combo on the focused element: Enter, Tab, Escape, Backspace, ArrowDown, PageDown, "a", "Control+a", "Shift+Tab".',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    key: { type: 'string', description: 'Key or combo, e.g. Enter, Escape, Control+a' },
                    repeat: { type: 'number', default: 1, description: 'Press the key this many times.' },
                },
                required: ['key'],
            },
        },
        {
            name: 'wrave_select_option',
            description: 'Choose an option in a native <select> by value or visible label.',
            inputSchema: {
                type: 'object',
                properties: { tab_id: TAB, selector: SELECTOR, value: { type: 'string', description: 'Option value or label' } },
                required: ['selector', 'value'],
            },
        },
        {
            name: 'wrave_fill_form',
            description: 'Fill many form fields in one call: text inputs are replaced, selects matched by value/label, checkboxes/radios set to true/false. Optionally click a submit button afterwards.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    fields: {
                        type: 'array',
                        description: 'Fields to fill, in order.',
                        items: {
                            type: 'object',
                            properties: {
                                selector: { type: 'string', description: '@ref, CSS selector or text:Label' },
                                value: { type: ['string', 'number', 'boolean'], description: 'Text, option label/value, or true/false for checkboxes' },
                            },
                            required: ['selector', 'value'],
                        },
                    },
                    submit: { type: 'string', description: 'Optional selector of a button to click after filling.' },
                    snapshot: { type: 'boolean', default: false, description: 'Return a fresh snapshot afterwards.' },
                },
                required: ['fields'],
            },
        },
        {
            name: 'wrave_scroll_page',
            description: 'Scroll by an amount, to top/bottom, or until an element is in view.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    delta_y: { type: 'number', default: 600, description: 'Vertical scroll amount (negative = up)' },
                    delta_x: { type: 'number', default: 0, description: 'Horizontal scroll amount' },
                    to: { type: 'string', enum: ['top', 'bottom'], description: 'Jump to top or bottom of the page.' },
                    selector: { type: 'string', description: 'Scroll this element into view instead.' },
                },
            },
        },
        {
            name: 'wrave_wait_for',
            description: 'Wait until an element and/or text appears (or disappears with gone=true). With no selector/text, waits for the page to finish loading and settle.',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: TAB,
                    selector: SELECTOR,
                    text: { type: 'string', description: 'Text that must appear on the page (case-insensitive).' },
                    gone: { type: 'boolean', default: false, description: 'Wait for it to disappear instead.' },
                    timeout_ms: { type: 'number', default: 10000 },
                },
            },
        },
        {
            name: 'wrave_batch',
            description: 'Run several Wrave tools in sequence in ONE call, which avoids a round trip per step. Stops at the first error by default. Example steps: [{"tool":"wrave_fill_form","args":{...}}, {"tool":"wrave_click","args":{"selector":"text:Search"}}, {"tool":"wrave_wait_for","args":{"text":"results"}}, {"tool":"wrave_get_text","args":{"selector":"#results"}}].',
            inputSchema: {
                type: 'object',
                properties: {
                    tab_id: { type: 'string', description: 'Default tab for every step (steps may override).' },
                    steps: {
                        type: 'array',
                        description: 'Steps to run in order.',
                        items: {
                            type: 'object',
                            properties: {
                                tool: { type: 'string', description: 'Tool name, e.g. wrave_click' },
                                args: { type: 'object', description: 'Arguments for that tool' },
                            },
                            required: ['tool'],
                        },
                    },
                    stop_on_error: { type: 'boolean', default: true },
                    snapshot_after: { type: 'boolean', default: false, description: 'Append a snapshot of the final page state.' },
                },
                required: ['steps'],
            },
        },
        // --- Scripting & diagnostics ---
        {
            name: 'wrave_execute_script',
            description: 'Evaluate JavaScript in the page and return the (JSON-serializable) result. Supports top-level await. Powerful for bulk extraction, e.g. [...document.querySelectorAll("h3")].map(e => e.innerText).',
            inputSchema: {
                type: 'object',
                properties: { tab_id: TAB, script: { type: 'string', description: 'JavaScript expression to evaluate' } },
                required: ['script'],
            },
        },
        {
            name: 'wrave_get_cookies',
            description: 'Cookies for the current page.',
            inputSchema: { type: 'object', properties: { tab_id: TAB } },
        },
        {
            name: 'wrave_print_to_pdf',
            description: 'Save the page as a PDF file on disk and return its path.',
            inputSchema: {
                type: 'object',
                properties: { tab_id: TAB, path: { type: 'string', description: 'Output file path (default: temp folder).' } },
            },
        },
        {
            name: 'wrave_get_console_logs',
            description: 'Console messages and uncaught exceptions captured since Wrave attached to the tab.',
            inputSchema: { type: 'object', properties: { tab_id: TAB, clear: { type: 'boolean', default: false, description: 'Clear the buffer after reading.' } } },
        },
    ];
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
/** Renders a snapshot as compact text: one line per element (~5x fewer tokens than pretty JSON). */
export function formatSnapshot(s, includeBoxes = false) {
    if (!s || typeof s !== 'object')
        return 'No snapshot available.';
    const lines = [];
    lines.push(`Page: ${s.title || '(untitled)'}`);
    lines.push(`URL: ${s.url || ''}`);
    if (s.scroll && s.scroll.height > s.scroll.viewport) {
        lines.push(`Scroll: ${s.scroll.y}px of ${Math.max(0, s.scroll.height - s.scroll.viewport)}px`);
    }
    if (s.error)
        lines.push(`Snapshot error: ${s.error}`);
    const els = Array.isArray(s.elements) ? s.elements : [];
    if (els.length === 0)
        lines.push('(no interactive elements found)');
    for (const el of els) {
        const tag = el.tag || '';
        let kind = el.role || (tag === 'a' ? 'link' : tag);
        if (tag === 'input' && !el.role)
            kind = `input[${el.type || 'text'}]`;
        const label = el.text || el.ariaLabel || el.title || '';
        const parts = [el.ref, kind];
        if (label)
            parts.push(JSON.stringify(trunc(label, 80)));
        if (el.ariaLabel && el.text && el.ariaLabel !== el.text)
            parts.push(`aria=${JSON.stringify(trunc(el.ariaLabel, 60))}`);
        if (el.placeholder)
            parts.push(`placeholder=${JSON.stringify(trunc(el.placeholder, 60))}`);
        if (el.name && ['input', 'select', 'textarea'].includes(tag))
            parts.push(`name=${el.name}`);
        if (el.value !== undefined && el.value !== '')
            parts.push(`value=${JSON.stringify(el.value)}`);
        if (Array.isArray(el.options))
            parts.push(`options=[${el.options.map((o) => trunc(o, 30)).join('|')}]`);
        if (el.href && !/^javascript:/i.test(el.href))
            parts.push(`-> ${trunc(el.href, 80)}`);
        if (el.checked === true)
            parts.push('(checked)');
        if (el.checked === false)
            parts.push('(unchecked)');
        if (el.expanded === true)
            parts.push('(expanded)');
        if (el.disabled)
            parts.push('(disabled)');
        if (el.offscreen)
            parts.push('(offscreen)');
        if (includeBoxes && Array.isArray(el.box))
            parts.push(`[${el.box.join(',')}]`);
        lines.push(parts.join(' '));
    }
    if (s.truncated) {
        lines.push(`(${els.length} of ${s.total} elements shown; raise max_elements, use viewport_only after scrolling, or read content with wrave_get_text)`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=tool-definitions.js.map