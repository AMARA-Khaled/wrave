#!/usr/bin/env node
/**
 * Wrave MCP CLI & Daemon Entry Point (TypeScript)
 * Usage:
 *   node cli.js --server [--port 8282] [--cdp-port 9222] [--token <secret>]
 *   node cli.js --stdio [--cdp-port 9222]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { WraveMcpServer } from './mcp-server.js';
import { WraveCdpEngine } from './cdp-engine.js';
import { SecurityMode } from './types.js';

interface CliOptions {
  mode: 'server' | 'stdio';
  port: number;
  host: string;
  cdpPort: number;
  cdpHost: string;
  securityMode: SecurityMode;
  token: string | null;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const isPipe = !process.stdin.isTTY;
  const options: CliOptions = {
    mode: isPipe ? 'stdio' : 'server', // stdio if spawned by AI harness, server if run interactively in terminal
    port: 8282,
    host: '127.0.0.1',
    cdpPort: 9222,
    cdpHost: '127.0.0.1',
    securityMode: 'ask_validation',
    token: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stdio') options.mode = 'stdio';
    else if (arg === '--server') options.mode = 'server';
    else if (arg === '--port' && args[i + 1]) options.port = parseInt(args[++i], 10);
    else if (arg === '--host' && args[i + 1]) options.host = args[++i];
    else if (arg === '--cdp-port' && args[i + 1]) options.cdpPort = parseInt(args[++i], 10);
    else if (arg === '--cdp-host' && args[i + 1]) options.cdpHost = args[++i];
    else if (arg === '--security' && args[i + 1]) options.securityMode = args[++i] as SecurityMode;
    else if (arg === '--token' && args[i + 1]) options.token = args[++i];
  }
  return options;
}

function saveTokenToAppData(token: string, port: number): string | null {
  try {
    const appData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const wraveDir = path.join(appData, 'Wrave');
    fs.mkdirSync(wraveDir, { recursive: true });
    
    const configPath = path.join(wraveDir, 'mcp_config.json');
    const config = {
      token,
      port,
      sseUrl: `http://127.0.0.1:${port}/mcp/sse`,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return configPath;
  } catch {
    return null;
  }
}

async function runStdioMode(options: CliOptions): Promise<void> {
  const mcpServer = new WraveMcpServer({
    cdpOptions: {
      host: options.cdpHost,
      port: options.cdpPort,
      securityMode: options.securityMode,
    },
  });

  // Start internal WebSocket bridge so Brave extension connects quietly on port 8282
  await mcpServer.startBridgeOnly(options.port || 8282, options.host || '127.0.0.1');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      const res = await mcpServer.handleRpcMessage(msg, 'Stdio Client');
      if (res) {
        process.stdout.write(JSON.stringify(res) + '\n');
      }
    } catch (err: any) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: err.message },
        }) + '\n'
      );
    }
  });
}

async function runServerMode(options: CliOptions): Promise<void> {
  const mcpServer = new WraveMcpServer({
    port: options.port,
    host: options.host,
    authToken: options.token === 'none' ? undefined : (options.token || 'wrave-agent-' + Math.random().toString(36).substring(2, 10)),
    cdpOptions: {
      host: options.cdpHost,
      port: options.cdpPort,
      securityMode: options.securityMode,
    },
  });

  const info = await mcpServer.start();
  const configPath = saveTokenToAppData(info.token, info.port);

  console.log('====================================================');
  console.log('  🌿 Wrave AI Browser Model Context Protocol (MCP)');
  console.log('====================================================');
  console.log(` Status:           RUNNING`);
  console.log(` SSE Endpoint:     ${info.sseUrl}`);
  console.log(` HTTP JSON-RPC:    http://${info.host}:${info.port}/mcp`);
  console.log(` Bearer Token:     ${info.token}`);
  console.log(` Security Mode:    ${options.securityMode}`);
  console.log(` Chromium CDP:     http://${options.cdpHost}:${options.cdpPort}`);
  if (configPath) {
    console.log(` Config Saved:     ${configPath}`);
  }
  console.log('----------------------------------------------------');
  console.log(' To connect Claude Code / Antigravity, add to your MCP config:');
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          wrave: {
            url: info.sseUrl,
            headers: {
              Authorization: `Bearer ${info.token}`,
            },
          },
        },
      },
      null,
      2
    )
  );
  console.log('====================================================');

  const shutdown = () => {
    console.log('\n[Wrave] Shutting down MCP server...');
    mcpServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  const options = parseArgs();
  if (options.mode === 'stdio') {
    await runStdioMode(options);
  } else {
    await runServerMode(options);
  }
}

main().catch((err) => {
  console.error('[Wrave Fatal Error]:', err);
  process.exit(1);
});
