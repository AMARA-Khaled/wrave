/**
 * Automated Verification Suite for Wrave MCP & CDP Automation Engine
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
    const health = await fetch(`http://127.0.0.1:${testPort}/health`).then((r) => r.json());
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
    const initRes = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
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
          clientInfo: { name: 'claude-code-test', version: '1.0' },
        },
      }),
    }).then((r) => r.json());

    assert.strictEqual(initRes.result.serverInfo.name, 'wrave-browser-mcp');
    assert.strictEqual(initRes.result.protocolVersion, '2024-11-05');
    console.log('[PASS] MCP initialize protocol handshake verified');

    // 4. Test tools/list
    const toolsRes = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/list' }),
    }).then((r) => r.json());

    assert(Array.isArray(toolsRes.result.tools));
    assert(toolsRes.result.tools.length >= 19, 'Expected at least 19 tools');
    const toolNames = new Set(toolsRes.result.tools.map((t) => t.name));
    assert(toolNames.has('wrave_list_tabs'));
    assert(toolNames.has('wrave_open_tab'));
    assert(toolNames.has('wrave_move_cursor'));
    assert(toolNames.has('wrave_click'));
    assert(toolNames.has('wrave_type_text'));
    assert(toolNames.has('wrave_teleport_to_ai_cursor'));
    assert(toolNames.has('wrave_take_screenshot'));
    assert(toolNames.has('wrave_get_dom_tree'));
    assert(toolNames.has('wrave_get_accessibility_tree'));
    assert(toolNames.has('wrave_set_security_mode'));
    console.log(`[PASS] tools/list returned ${toolsRes.result.tools.length} browser automation primitives`);

    // 5. Test tool execution (wrave_set_security_mode)
    const setSecRes = await fetch(`http://127.0.0.1:${testPort}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'wrave_set_security_mode',
          arguments: { mode: 'full_access' },
        },
      }),
    }).then((r) => r.json());

    const contentText = JSON.parse(setSecRes.result.content[0].text);
    assert.strictEqual(contentText.status, 'updated');
    assert.strictEqual(contentText.mode, 'full_access');
    assert.strictEqual(server.cdpEngine.securityMode, 'full_access');
    console.log('[PASS] wrave_set_security_mode tool execution verified');

    // 6. Test SSE stream handshake
    const controller = new AbortController();
    const ssePromise = fetch(`http://127.0.0.1:${testPort}/mcp/sse`, {
      headers: { Authorization: `Bearer ${testToken}` },
      signal: controller.signal,
    });

    const sseResponse = await ssePromise;
    assert.strictEqual(sseResponse.status, 200);
    assert.strictEqual(sseResponse.headers.get('content-type'), 'text/event-stream');

    const reader = sseResponse.body.getReader();
    const { value: chunkVal } = await reader.read();
    const chunkStr = new TextDecoder().decode(chunkVal);
    assert(chunkStr.includes('event: endpoint'), 'Expected endpoint event in SSE');
    assert(chunkStr.includes('/mcp/message?sessionId='), 'Expected sessionId in endpoint event');
    console.log('[PASS] MCP Server-Sent Events (SSE) stream handshake verified');

    controller.abort(); // Close stream
    console.log('\n🎉 ALL WRAVE MCP INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    server.stop();
    console.log('[PASS] Server cleanly shut down.');
  }
}

runTestSuite().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
