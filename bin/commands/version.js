// version 命令：交互式升级项目版本号，自动同步所有相关文件并打 tag。
//
//   magpie version bump [--type patch|minor|major] [--target x.y.z] [--yes] [--dry-run]
//
// --type 与 --target 二选一；默认会询问确认；--yes 用于脚本/CI 场景。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const readline = require('readline');
const { out } = require('./_shared');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// 除 package.json / package-lock.json 外，需要手动同步版本的文件
const SYNC_FILES = [
  { path: 'skills/magpie/SKILL.md', pattern: (v) => new RegExp(`^  version: "${escapeRegex(v)}"$`, 'm'), replacement: (v) => `  version: "${v}"` },
  { path: 'docs/skill-integration-design.md', pattern: (v) => new RegExp(`^  version: "${escapeRegex(v)}"$`, 'm'), replacement: (v) => `  version: "${v}"` },
  { path: 'plugin-workspace/plugin.json', pattern: (v) => new RegExp(`"version": "${escapeRegex(v)}"`, 'g'), replacement: (v) => `"version": "${v}"` },
  { path: 'public/index.html', pattern: (v) => new RegExp(`\\?v=${escapeRegex(v)}`, 'g'), replacement: (v) => `?v=${v}` },
  { path: 'public/js/app.js', pattern: (v) => new RegExp(`\\?v=${escapeRegex(v)}`, 'g'), replacement: (v) => `?v=${v}` },
  { path: 'test/perf-bench.js', pattern: (v) => new RegExp(`\\?v=${escapeRegex(v)}`, 'g'), replacement: (v) => `?v=${v}` },
  { path: 'test/perf-harness.js', pattern: (v) => new RegExp(`\\?v=${escapeRegex(v)}`, 'g'), replacement: (v) => `?v=${v}` },
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bumpSemver(version, type) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`非法版本号：${version}`);
  }
  const [major, minor, patch] = parts;
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function question(rl, q) {
  return new Promise((resolve) => {
    rl.question(q, (answer) => resolve(answer.trim()));
  });
}

async function prompt(q) {
  if (!process.stdin.isTTY) {
    throw new Error('非交互式终端，请使用 --yes 选项或在交互式 shell 中运行');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await question(rl, q);
  } finally {
    rl.close();
  }
}

function usageError(msg) {
  const e = new Error(msg || '用法：magpie version bump [--type patch|minor|major] [--target x.y.z] [--yes] [--dry-run]');
  e.name = 'UsageError';
  return e;
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

function readPkgVersion() {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
}

function planSync(current, next) {
  const changed = [];
  for (const item of SYNC_FILES) {
    const filePath = path.join(REPO_ROOT, item.path);
    if (!fs.existsSync(filePath)) {
      throw new Error(`同步目标文件不存在：${item.path}`);
    }
    let content = fs.readFileSync(filePath, 'utf-8');
    const pat = item.pattern(current);
    if (!pat.test(content)) {
      throw new Error(`${item.path} 中未找到当前版本号 ${current}，请检查文件是否已手动修改`);
    }
    content = content.replace(item.pattern(current), item.replacement(next));
    changed.push({ path: item.path, content });
  }
  return changed;
}

function runCmd(command, argv) {
  execFileSync(command, argv, { cwd: REPO_ROOT, stdio: 'inherit' });
}

async function run(client, args) {
  const sub = args.sub;
  if (sub !== 'bump') {
    throw usageError();
  }

  const current = readPkgVersion();
  const target = args.opts.target;
  let type = args.opts.type;
  if (target && type) throw usageError('--target 和 --type 不能同时指定');
  let next;

  if (target) {
    if (!isValidSemver(target)) {
      throw usageError(`非法版本号：${target}，应为 x.y.z 格式`);
    }
    next = target;
  } else {
    if (!type) {
      type = await prompt(`当前版本 ${current}，请选择升级类型 [patch/minor/major]： `);
    }
    if (!['patch', 'minor', 'major'].includes(type)) {
      throw usageError(`非法类型：${type}，仅支持 patch/minor/major`);
    }
    next = bumpSemver(current, type);
  }

  const dryRun = args.opts['dry-run'] || args.opts.dryRun;
  // Validate every target before npm version or any other write.
  const changed = planSync(current, next);
  const lockFiles = ['package-lock.json', 'npm-shrinkwrap.json'].filter(file => fs.existsSync(path.join(REPO_ROOT, file)));
  const files = ['package.json', ...lockFiles, ...changed.map(item => item.path)];
  if (dryRun) {
    out(`[演练模式] 将更新以下文件（未写入、未提交、未打 tag、未推送）：\n`);
    for (const file of files) out(`  ${file}\n`);
    out(`版本：${current} → ${next}\n`);
    return;
  }

  if (!args.opts.yes) {
    const filesList = SYNC_FILES.map((f) => `  - ${f.path}`).join('\n');
    const action = dryRun ? '（演练模式，不执行 git 操作）' : `并自动执行 commit + tag v${next}`;
    const answer = await prompt(
      `即将把版本从 ${current} 升级到 ${next}。\n` +
      `会同步更新以下文件（含 package.json / package-lock.json）：\n${filesList}\n` +
      `${action}。\n确认继续？[y/N] `
    );
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      out('已取消版本升级。\n');
      return;
    }
  }

  const originals = new Map(files.map(file => [file, fs.readFileSync(path.join(REPO_ROOT, file))]));
  try {
    runCmd('npm', ['version', next, '--no-git-tag-version', '--ignore-scripts']);
    for (const item of changed) fs.writeFileSync(path.join(REPO_ROOT, item.path), item.content, 'utf8');
  } catch (e) {
    for (const [file, content] of originals) fs.writeFileSync(path.join(REPO_ROOT, file), content);
    throw e;
  }

  // 3. git add + commit
  runCmd('git', ['add', '--', ...files]);
  runCmd('git', ['commit', '--only', '-m', `chore(release): bump version to ${next}`, '--', ...files]);

  // 4. 打 tag 并推送
  runCmd('git', ['tag', `v${next}`]);
  runCmd('git', ['push', 'origin', 'HEAD']);
  runCmd('git', ['push', 'origin', `v${next}`]);

  out(`✓ 已升级并推送：${current} → ${next}（tag v${next}）\n`);
  out('  npm 发布仍需单独授权与手动执行，当前工作流只验证和打包。\n');
}

module.exports = { run };
