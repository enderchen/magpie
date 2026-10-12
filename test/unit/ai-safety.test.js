const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getSkill, createZipStream, SKILLS_DIR } = require('../../skills-registry');
const repo = path.resolve(__dirname, '../..');

test('Skill names cannot escape and symlinked roots or metadata cannot expose files', () => {
  for (const name of ['.', '..', '../magpie', '/magpie', '%2e%2e']) {
    assert.equal(getSkill(name), null);
    assert.equal(createZipStream(name), null);
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-skill-links-'));
  const link = path.join(SKILLS_DIR, `test-link-${process.pid}`);
  const missing = path.join(SKILLS_DIR, `test-empty-${process.pid}`);
  try {
    fs.writeFileSync(path.join(temp, 'SKILL.md'), '---\nname: secret\n---\nsynthetic');
    fs.symlinkSync(temp, link);
    assert.equal(getSkill(path.basename(link)), null);
    fs.mkdirSync(missing);
    assert.equal(getSkill(path.basename(missing)), null);
    fs.symlinkSync(path.join(temp, 'SKILL.md'), path.join(missing, 'SKILL.md'));
    assert.equal(getSkill(path.basename(missing)), null);
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(missing, { recursive: true, force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Skill install/update/uninstall preserve foreign content and reject directory links', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-install-guard-'));
  const cli = (...args) => spawnSync(process.execPath, [path.join(repo, 'bin/magpie.js'), ...args], { encoding: 'utf8', cwd: temp });
  const foreign = path.join(temp, 'foreign');
  const target = path.join(temp, 'magpie');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'keep.txt'), 'preserve');
  try {
    for (const sub of ['install', 'uninstall']) {
      assert.notEqual(cli('skill', sub, '--dir', foreign).status, 0);
      assert.equal(fs.readFileSync(path.join(foreign, 'keep.txt'), 'utf8'), 'preserve');
    }
    fs.symlinkSync(foreign, target);
    assert.notEqual(cli('skill', 'install', '--dir', target).status, 0);
    fs.unlinkSync(target);
    assert.equal(cli('skill', 'install', '--dir', target).status, 0);
    assert.equal(cli('skill', 'update', '--dir', target).status, 0);
    fs.writeFileSync(path.join(target, 'user-content.txt'), 'keep');
    assert.notEqual(cli('skill', 'update', '--dir', target).status, 0);
    assert.notEqual(cli('skill', 'uninstall', '--dir', target).status, 0);
    assert.equal(fs.readFileSync(path.join(target, 'user-content.txt'), 'utf8'), 'keep');
    fs.unlinkSync(path.join(target, 'user-content.txt'));
    assert.equal(cli('skill', 'uninstall', '--dir', target).status, 0);
    assert.equal(fs.existsSync(target), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('version dry-run validates all files and never writes, including a stale sync target', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-version-plan-'));
  const files = ['package.json', 'package-lock.json', 'skills/magpie/SKILL.md', 'docs/skill-integration-design.md', 'plugin-workspace/plugin.json', 'public/index.html', 'public/js/app.js', 'test/perf-bench.js', 'test/perf-harness.js'];
  fs.cpSync(path.join(repo, 'bin'), path.join(temp, 'bin'), { recursive: true });
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true }); fs.copyFileSync(path.join(repo, file), path.join(temp, file)); }
  const run = () => spawnSync(process.execPath, [path.join(temp, 'bin/magpie.js'), 'version', 'bump', '--type', 'patch', '--yes', '--dry-run'], { cwd: temp, encoding: 'utf8' });
  const snapshot = () => files.map(file => fs.readFileSync(path.join(temp, file), 'utf8'));
  try {
    const before = snapshot();
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /未写入/);
    assert.deepEqual(snapshot(), before);
    fs.writeFileSync(path.join(temp, 'test/perf-bench.js'), 'stale file');
    const broken = snapshot();
    assert.equal(run().status, 1);
    assert.deepEqual(snapshot(), broken);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('invalid CLI options cannot publish or overwrite before validation', async () => {
  const { run } = require('../../bin/magpie');
  let calls = 0;
  for (const args of [
    ['upload', '--public=maybe', 'missing.html'],
    ['upload', 'missing.html', '--overwrite'],
    ['upload', 'missing.html', '--overwrite', '-1'],
    ['upload', 'missing.html', '--overwrite=true'],
    ['ls', '--base'], ['ls', '--token'],
    ['ls', '--base', 'https://example.test/?token=secret'],
  ]) {
    let status = 0, output = '';
    await run(args, { env: { MAGPIE_TOKEN: 'test' }, cwd: os.tmpdir(), stdout: { write() {} }, stderr: { write(value) { output += value; } }, exit(code) { status = code; }, fetchImpl() { calls++; throw new Error('unexpected request'); } });
    assert.equal(status, 2, output);
    assert.equal(calls, 0);
  }
});
