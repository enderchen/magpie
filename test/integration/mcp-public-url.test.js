const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createTestEnv } = require('../helpers/setup');

test('HTTP内部服务的MCP及指南统一返回APP_URL的HTTPS地址', async () => {
  process.env.APP_URL = 'https://magpiesend.site/';
  process.env.PORT = '80';
  process.env.MCP_IP = 'magpiesend.site';
  process.env.MCP_PROTOCOL = 'https';
  const env = createTestEnv();
  await env.ready();
  const agent = request.agent(env.app);
  await agent.post('/api/auth/login').send({ username: 'admin', password: 'testpassword123' });
  const token = (await agent.post('/api/tokens').send({ name: 'public-url' })).body.token;
  const server = await new Promise(resolve => { const s = env.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const client = new Client({ name: 'public-url-test', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError);
      return JSON.parse(result.content[0].text);
    };
    const file = await call('upload_file', { name: 'canonical.md', content: 'external URL', isPublic: true });
    assert.match(file.url, /^https:\/\/magpiesend\.site\/s\//);
    const link = await call('get_file_url', { id: file.id });
    assert.equal(link.url, file.url);
    const list = await call('list_files', {});
    assert.equal(list.files.find(f => f.id === file.id).url, file.url);
    await call('delete_file', { id: file.id });
    const config = (await agent.get('/api/mcp/config')).body;
    assert.equal(config.url, 'https://magpiesend.site/mcp');
    const guide = (await agent.get('/api/cli/guide')).body;
    assert.equal(guide.baseUrl, 'https://magpiesend.site');
  } finally {
    await client.close();
    await new Promise(resolve => server.close(resolve));
    env.cleanup();
  }
});
