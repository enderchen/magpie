const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const request = require('supertest');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { createTestEnv } = require('../helpers/setup');

test('exported desktop stdio configuration supports real tools/resources and token revocation', async () => {
  const env = createTestEnv();
  await env.ready();
  const server = await new Promise(resolve => { const s = env.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const agent = request.agent(env.app);
  const client = new Client({ name: 'desktop-config-test', version: '1' }, { capabilities: {} });
  try {
    await agent.post('/api/auth/login').send({ username: 'admin', password: 'testpassword123' }).expect(200);
    const token = (await agent.post('/api/tokens').send({ name: 'stdio-test' }).expect(200)).body;
    const configs = (await agent.get('/api/mcp/config').expect(200)).body.configs;
    const config = configs.find(c => c.id === 'claude-desktop').config.mcpServers.magpie;
    assert.deepEqual(config.args, ['mcp']);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve(__dirname, '../../bin/magpie.js'), ...config.args],
      env: { ...config.env, APP_URL: 'https://unrelated.example', MAGPIE_BASE: base, MAGPIE_TOKEN: token.token }, cwd: env.dataDir,
    });
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 18);
    assert.equal((await client.listResources()).resources.length, 1);
    const uploaded = await client.callTool({ name: 'upload_file', arguments: { name: 'stdio-canary.md', content: '# STDIO CANARY', isPublic: false } });
    const file = JSON.parse(uploaded.content[0].text);
    assert.equal(new URL(file.url).origin, base, 'stdio必须使用客户端MAGPIE_BASE，不能继承其他应用APP_URL');
    const read = await client.callTool({ name: 'get_file_content', arguments: { id: file.id } });
    assert.match(read.content[0].text, /STDIO CANARY/);
    const resource = await client.readResource({ uri: `magpie://file/${file.id}` });
    assert.match(resource.contents[0].text, /STDIO CANARY/);
    const metadata = (await agent.get(`/api/files/${file.id}`).expect(200)).body;
    assert.equal(metadata.upload_source, 'mcp');
    await client.callTool({ name: 'delete_file', arguments: { id: file.id } });
    await agent.get(`/api/files/${file.id}`).expect(404);
    await agent.delete(`/api/tokens/${token.id}`).expect(200);
    const revoked = await client.callTool({ name: 'upload_file', arguments: { name: 'revoked.md', content: 'blocked' } });
    assert.equal(revoked.isError, true);
  } finally {
    await client.close();
    await new Promise(resolve => server.close(resolve));
    env.cleanup();
  }
});
