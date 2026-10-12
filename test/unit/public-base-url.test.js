const test = require('node:test');
const assert = require('node:assert/strict');
const { publicBaseUrl } = require('../../lib/util');

test('HTTPS外部地址不继承内部HTTP端口', () => {
  assert.equal(publicBaseUrl('http://127.0.0.1:80', 'https://magpiesend.site/'), 'https://magpiesend.site');
});
test('IP入口移除尾斜杠并保留外部自定义端口', () => {
  assert.equal(publicBaseUrl('http://localhost:80', 'http://82.156.74.168:8080///'), 'http://82.156.74.168:8080');
});
test('未配置APP_URL时保留本地默认地址', () => {
  assert.equal(publicBaseUrl('http://localhost:8858', ''), 'http://localhost:8858');
});
