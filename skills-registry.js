const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const logger = require('./logger');

const SKILLS_DIR = path.join(__dirname, 'skills');

function safeListDirs(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function walkFiles(root) {
  const result = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? path.posix.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        stack.push(childRel);
      } else if (entry.isFile()) {
        const stat = fs.statSync(path.join(abs, entry.name));
        result.push({ relPath: childRel, absPath: path.join(abs, entry.name), size: stat.size });
      }
    }
  }
  return result;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      let v = kv[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      meta[kv[1]] = v;
    }
  }
  // Skill metadata follows the standard nested metadata block.
  const metadata = m[1].match(/^metadata:\s*\n((?:[ \t]+[^\n]*(?:\n|$))*)/m);
  if (metadata) {
    for (const line of metadata[1].split(/\r?\n/)) {
      const kv = line.match(/^[ ]{2}(version|author):\s*["']?([^"'\n]+?)["']?\s*$/);
      if (kv) meta[kv[1]] = kv[2];
    }
  }
  return { meta, body: m[2] };
}

function readSkillMeta(skillName) {
  const skillRoot = resolveSkillRoot(skillName);
  if (!skillRoot) return null;
  const skillMdPath = path.join(skillRoot, 'SKILL.md');
  let parsed = { meta: {}, body: '' };
  if (fs.existsSync(skillMdPath)) {
    parsed = parseFrontmatter(fs.readFileSync(skillMdPath, 'utf-8'));
  }
  const meta = parsed.meta;
  if (!meta.name) meta.name = skillName;
  const files = walkFiles(skillRoot);
  const installMdPath = path.join(skillRoot, 'INSTALL.md');
  let installBody = '';
  if (fs.existsSync(installMdPath) && fs.lstatSync(installMdPath).isFile()) {
    installBody = fs.readFileSync(installMdPath, 'utf-8');
  }
  return {
    name: skillName,
    title: meta.name,
    description: meta.description || '',
    version: meta.version || '',
    author: meta.author || '',
    fileCount: files.length,
    totalSize: files.reduce((s, f) => s + f.size, 0),
    files: files.map(f => f.relPath),
    body: parsed.body,
    installBody,
  };
}

function listSkills() {
  const names = safeListDirs(SKILLS_DIR);
  const skills = [];
  for (const name of names) {
    const skillRoot = path.join(SKILLS_DIR, name);
    const skillMd = path.join(skillRoot, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const meta = readSkillMeta(name);
    if (meta) {
      skills.push({
        name: meta.name,
        title: meta.title,
        description: meta.description,
        version: meta.version,
        author: meta.author,
        fileCount: meta.fileCount,
        totalSize: meta.totalSize,
      });
    }
  }
  return skills;
}

function getSkill(name) {
  return readSkillMeta(name);
}

function resolveSkillRoot(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
  try {
    const base = fs.realpathSync(SKILLS_DIR);
    const candidate = path.join(base, name);
    if (!fs.lstatSync(candidate).isDirectory()) return null; // Reject directory symlinks.
    const root = fs.realpathSync(candidate);
    const relative = path.relative(base, root);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    if (!fs.lstatSync(path.join(root, 'SKILL.md')).isFile()) return null;
    return root;
  } catch (e) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(e.code)) return null;
    throw e;
  }
}

function createZipStream(name) {
  const skill = getSkill(name);
  if (!skill) return null;
  const skillRoot = resolveSkillRoot(name);
  if (!skillRoot) return null;
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', (err) => {
    if (err.code !== 'ENOENT') logger.error({ type: 'app', message: 'archiver 警告', error: err.message });
  });
  archive.on('error', (err) => {
    logger.error({ type: 'app', message: 'archiver 错误', error: err.message });
  });
  // Match the advertised file list and never archive symlinks or their targets.
  for (const file of walkFiles(skillRoot)) {
    archive.file(file.absPath, { name: `${name}/${file.relPath}` });
  }
  return archive;
}

module.exports = { listSkills, getSkill, createZipStream, SKILLS_DIR };
