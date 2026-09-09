/**
 * Automated Verification Suite for Wrave MCP & CDP Automation Engine (TypeScript)
 */
import assert from 'node:assert';
import { WraveMcpServer } from '../mcp-server.js';
async function runTestSuite() {
    console.log('🧪 Starting Wrave MCP Automated Test Suite...\n');
    const testPort = 8299;
    const testToken = 'wrave-test-token-xyz789';
    const server = new WraveMcpServer({
        port: testPort,
        host: '127.0.0.1',
        authToken: testToken,
        requireAuth: true,
        cdpOptions: {
            host: '127.0.0.1',
            port: 9222,
            securityMode: 'ask_validation',
        },
    });
    const info = await server.start();
    console.log(`[PASS] Server started on port ${info.port}`);
    try {
        // 1. Test /health endpoint
        const health = (await fetch(`http://127.0.0.1:${testPort}/health`, {
            headers: { Authorization: `Bearer ${testToken}` },
        }).then((r) => r.json()));
        assert.strictEqual(health.status, 'running');
        assert.strictEqual(health.securityMode, 'ask_validation');
        console.log('[PASS] /health endpoint verified');
        // 2. Test 401 Unauthorized on missing/bad token
        const unauthRes = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        assert.strictEqual(unauthRes.status, 401, 'Expected 401 on unauthenticated request');
        console.log('[PASS] Bearer token security enforcement verified (401 on unauthorized)');
        // 3. Test MCP initialize handshake
        const initRes = (await fetch(`http://127.0.0.1:${testPort}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${testToken}`,
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 10,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'antigravity-test', version: '1.0' },
                },
            }),
        }).then((r) => r.json()));
        assert.strictEqual(initRes.result.serverInfo.name, 'wrave-mcp-server');
        assert.strictEqual(initRes.result.protocolVersion, '2024-11-05');
        console.log('[PASS] MCP initialize protocol handshake verified');
        // 4. Test tools/list
        const toolsRes = (await fetch(`http://127.0.0.1:${testPort}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${testToken}`,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/list' }),
        }).then((r) => r.json()));
        assert(Array.isArray(toolsRes.result.tools));
        assert(toolsRes.result.tools.length >= 10, 'Expected at least 10 tools');
        const toolNames = new Set(toolsRes.result.tools.map((t) => t.name));
        assert(toolNames.has('wrave_list_tabs'));
        assert(toolNames.has('wrave_open_tab'));
        assert(toolNames.has('wrave_close_tab'));
        assert(toolNames.has('wrave_focus_tab'));
        assert(toolNames.has('wrave_reload_tab'));
        assert(toolNames.has('wrave_get_tab_state'));
        assert(toolNames.has('wrave_click'));
        assert(toolNames.has('wrave_type_text'));
        assert(toolNames.has('wrave_take_screenshot'));
        assert(toolNames.has('wrave_get_dom_tree'));
        assert(toolNames.has('wrave_get_accessibility_tree'));
        assert(toolNames.has('wrave_execute_script'));
        assert(toolNames.has('wrave_get_cookies'));
        assert(toolNames.has('wrave_get_snapshot'), 'Missing wrave_get_snapshot');
        assert(toolNames.has('wrave_click_and_read'), 'Missing wrave_click_and_read');
        assert(toolNames.has('wrave_type_and_submit'), 'Missing wrave_type_and_submit');
        console.log(`[PASS] tools/list returned ${toolsRes.result.tools.length} browser automation primitives (including compound snapshot & interaction tools)`);
        // 5. Test SSE stream handshake and bidirectional message routing
        const controller = new AbortController();
        const sseResponse = await fetch(`http://127.0.0.1:${testPort}/mcp/sse?token=${testToken}`, {
            signal: controller.signal,
        });
        assert.strictEqual(sseResponse.status, 200);
        assert.strictEqual(sseResponse.headers.get('content-type'), 'text/event-stream');
        assert(sseResponse.headers.get('mcp-session-id'), 'Expected Mcp-Session-Id header in SSE response');
        const reader = sseResponse.body.getReader();
        const { value: chunkVal } = await reader.read();
        const chunkStr = new TextDecoder().decode(chunkVal);
        assert(chunkStr.includes('event: endpoint'), 'Expected endpoint event in SSE');
        assert(chunkStr.includes('http://'), 'Expected absolute http:// URL in endpoint event');
        assert(chunkStr.includes('sessionId='), 'Expected sessionId in endpoint event');
        console.log('[PASS] MCP Server-Sent Events (SSE) stream handshake verified with absolute URL & Mcp-Session-Id header');
        // Extract sessionId
        const sessionMatch = chunkStr.match(/sessionId=([a-f0-9]+)/);
        assert(sessionMatch && sessionMatch[1], 'Could not extract sessionId');
        const sessionId = sessionMatch[1];
        // Send JSON-RPC message over POST
        const postRes = await fetch(`http://127.0.0.1:${testPort}/mcp/message?sessionId=${sessionId}&token=${testToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/list' }),
        });
        assert(postRes.status === 200 || postRes.status === 202, `Expected status 200 or 202, got ${postRes.status}`);
        assert(postRes.headers.get('mcp-session-id'), 'Expected Mcp-Session-Id header in POST response');
        // Read response from SSE stream
        const { value: respChunk } = await reader.read();
        const respStr = new TextDecoder().decode(respChunk);
        assert(respStr.includes('event: message'), 'Expected message event in SSE');
        assert(respStr.includes('"id":42') || respStr.includes('"id": 42'), 'Expected RPC response id 42 on SSE stream');
        console.log('[PASS] MCP bidirectional SSE request/response cycle verified');
        controller.abort(); // Close stream
        console.log('\n🎉 ALL WRAVE MCP INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
    }
    finally {
        server.stop();
        console.log('[PASS] Server cleanly shut down.');
    }
}
runTestSuite().catch((err) => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
});
//# sourceMappingURL=test-mcp.js.map