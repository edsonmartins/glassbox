#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const { server, tuiBridge } = createServer();

  // Start TUI bridge if GLASSBOX_TUI=1 or --tui flag
  const enableTui = process.env.GLASSBOX_TUI === '1' || process.argv.includes('--tui');
  if (enableTui) {
    const socketPath = await tuiBridge.start();
    process.stderr.write(`glassbox-tui-socket: ${socketPath}\n`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`glassbox-mcp: fatal error: ${err}\n`);
  process.exit(1);
});
