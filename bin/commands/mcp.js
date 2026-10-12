// Local MCP clients launch this stdio entry; calls use the user's REST token.
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createMcpServer } = require('../../mcp/server');
const { createClient } = require('../client');

async function run(_client, _args, { base, token }) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new Error('MAGPIE_BASE 必须是 HTTP(S) 服务根地址，不含路径或用户名密码');
  }
  const api = createClient({ base, token, source: 'mcp' });
  await api.get('/api/files?limit=1'); // Fail before handshake if the token is invalid.
  const server = createMcpServer({
    api, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    mcpIp: url.hostname, protocol: url.protocol.slice(0, -1),
  });
  await server.connect(new StdioServerTransport());
  process.stdin.once('end', () => { server.close().catch(() => {}); });
}

module.exports = { run };
