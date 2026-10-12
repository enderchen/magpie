// skill 命令：将本 npm 包内置的 magpie Skill 安装到 Claude / 类似客户端的 skills 目录。
//
//   magpie skill install [--dir <路径>]
//   magpie skill update                    （install 的别名）
//   magpie skill uninstall [--dir <路径>]

const fs = require('fs');
const path = require('path');
const os = require('os');
const { out } = require('./_shared');

// Skill 源目录：npm 包内的 skills/magpie/
const SOURCE_SKILL_DIR = path.resolve(__dirname, '..', '..', 'skills', 'magpie');

// 常见 skills 目录候选（按优先级）
function candidateDirs() {
  const home = os.homedir();
  return [
    process.env.MAGPIE_SKILL_DIR,
    path.join(home, '.claude', 'skills', 'magpie'),
    path.join(home, '.claude-code', 'skills', 'magpie'),
    path.join(home, '.agents', 'skills', 'magpie'),
  ].filter(Boolean);
}

function detectTargetDir(explicitDir) {
  if (explicitDir) return path.resolve(explicitDir);

  const candidates = candidateDirs();
  // 优先使用父目录已存在的候选（说明用户确实在该客户端下使用过 skills）
  for (const c of candidates) {
    if (fs.existsSync(path.dirname(c))) return c;
  }
  // 都没有则默认 ~/.claude/skills/magpie
  return candidates[0];
}

function ensureSource() {
  if (!fs.existsSync(SOURCE_SKILL_DIR)) {
    throw new Error(`未找到内置 Skill 目录：${SOURCE_SKILL_DIR}。请确认 magpie 安装完整。`);
  }
}

function sourceFiles(dir = SOURCE_SKILL_DIR, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) return sourceFiles(path.join(dir, entry.name), relative);
    return [relative];
  });
}

function validateTarget(target) {
  if (target === path.parse(target).root || target === os.homedir() ||
      target === SOURCE_SKILL_DIR || SOURCE_SKILL_DIR.startsWith(target + path.sep) ||
      target.startsWith(SOURCE_SKILL_DIR + path.sep)) {
    throw new Error('拒绝把根目录、个人主目录或技能源码目录作为安装目标');
  }
  if (!fs.existsSync(target)) {
    // A dangling symlink must not be treated as a new directory.
    try { fs.lstatSync(target); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    throw new Error('安装目标不能是符号链接');
  }
  if (!fs.lstatSync(target).isDirectory()) throw new Error('安装目标必须是普通目录，不能是符号链接');
  const actual = fs.realpathSync(target);
  const source = fs.realpathSync(SOURCE_SKILL_DIR);
  if (source === actual || source.startsWith(actual + path.sep) || actual.startsWith(source + path.sep)) {
    throw new Error('安装目标与技能源码目录重叠');
  }
  const entries = fs.readdirSync(target);
  if (!entries.length) return;
  const md = path.join(target, 'SKILL.md');
  if (!fs.existsSync(md) || !fs.lstatSync(md).isFile() ||
      !/^name:\s*magpie\s*$/m.test(fs.readFileSync(md, 'utf8'))) {
    throw new Error('目标目录不是已安装的 magpie Skill，拒绝删除原有内容');
  }
  const allowed = new Set(sourceFiles());
  function inspect(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) inspect(path.join(dir, entry.name), relative);
      else if (!entry.isFile() || !allowed.has(relative)) {
        throw new Error(`目标目录含非 Skill 内容：${relative}，拒绝删除`);
      }
    }
  }
  inspect(target);
}

async function installSkill(explicitDir) {
  ensureSource();
  const target = detectTargetDir(explicitDir);
  validateTarget(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(target), '.magpie-install-'));
  const backup = staging + '-previous';
  try {
    fs.cpSync(SOURCE_SKILL_DIR, staging, { recursive: true, preserveTimestamps: true });
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    try { fs.renameSync(staging, target); }
    catch (e) {
      if (fs.existsSync(backup)) fs.renameSync(backup, target);
      throw e;
    }
    fs.rmSync(backup, { recursive: true, force: true });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  const pkg = require('../../package.json');
  out(`✓ 已安装 magpie Skill v${pkg.version} → ${target}\n`);
  out(`  使用方式：在 Claude Code / Desktop 的 skills 设置中确认已加载「magpie」\n`);
  out(`  如需指定目录：magpie skill install --dir /path/to/skills/magpie\n`);
}

async function uninstallSkill(explicitDir) {
  ensureSource();
  const target = detectTargetDir(explicitDir);
  validateTarget(target);
  if (!fs.existsSync(target)) {
    out(`（Skill 未安装于 ${target}）\n`);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
  out(`✓ 已移除 magpie Skill：${target}\n`);
}

async function run(client, args) {
  const sub = args.sub || 'install';
  const explicitDir = args.opts.dir;

  if (sub === 'install' || sub === 'update') {
    return installSkill(explicitDir);
  }
  if (sub === 'uninstall') {
    return uninstallSkill(explicitDir);
  }

  const e = new Error(`未知子命令：${sub}。支持：install / update / uninstall`);
  e.name = 'UsageError';
  throw e;
}

module.exports = { run };
