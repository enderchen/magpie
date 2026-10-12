// 零依赖 argv 解析器。
//
// 约定：
//   - 以 `--` 开头的 token 是选项（长选项）；支持 `--key value` 和 `--key=value` 两种形式
//   - 不支持单字母组合短选项（-a），避免歧义；单字母需求用长选项
//   - 布尔标志：出现即为 true（如 --public）。需要显式值时用 --key=value
//   - 其余 token 是位置参数（positional）
//   - 第一个位置参数视作命令（cmd），第二个视作子命令（sub）
//
// 返回：{ cmd, sub, opts, positional }
//   cmd        第一个位置参数（字符串，无则 null）
//   sub        第二个位置参数（字符串，无则 null）
//   opts       选项对象（键名去掉 -- 前缀，值默认 true，否则字符串）
//   positional 全部位置参数数组（含 cmd/sub）
//
// 设计目标：够用、可预测、无运行时依赖。commander 级别的复杂场景（子命令嵌套、
// 变长参数类型校验）超出 CLI 需求，故不引入。

const { UsageError } = require('./commands/upload');
const VALUE_OPTIONS = new Set(['token', 'base', 'overwrite', 'out', 'dir', 'type', 'target', 'category', 'file-type', 'fileType', 'kw', 'limit', 'name', 'registry', 'page', 'cat', 'tag', 'sort', 'order']);

const BOOLEAN_OPTIONS = new Set(['public', 'private', 'yes', 'help', 'h', 'version', 'check', 'dry-run', 'dryRun', 'verbose']);

function parse(argv) {
  const opts = {};
  const positional = [];
  let cmd = null;
  let sub = null;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];

    if (tok === '-h' || tok === '-v') {
      opts[tok === '-h' ? 'help' : 'version'] = true;
      continue;
    }

    if (tok === '--') {
      // 之后的全部当位置参数
      for (let j = i + 1; j < argv.length; j++) positional.push(argv[j]);
      break;
    }

    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq > 1) {
        // --key=value
        const key = tok.slice(2, eq);
        const value = tok.slice(eq + 1);
        if (BOOLEAN_OPTIONS.has(key) && !['true', 'false'].includes(value)) throw new UsageError(`--${key} 只接受 true 或 false`);
        if (VALUE_OPTIONS.has(key) && !value) throw new UsageError(`--${key} 缺少参数值`);
        opts[key] = BOOLEAN_OPTIONS.has(key) ? value === 'true' : value;
      } else {
        const key = tok.slice(2);
        const next = argv[i + 1];
        if (VALUE_OPTIONS.has(key) && (next === undefined || next.startsWith('--') || next === '-h' || next === '-v')) throw new UsageError(`--${key} 缺少参数值`);
        // 下一个 token 不是选项（且存在）→ 当作值；否则当布尔标志
        if (!BOOLEAN_OPTIONS.has(key) && next !== undefined && (!next.startsWith('-') || VALUE_OPTIONS.has(key))) {
          opts[key] = next;
          i++;
        } else {
          opts[key] = true;
        }
      }
      continue;
    }

    positional.push(tok);
  }

  if (positional.length >= 1) cmd = positional[0];
  if (positional.length >= 2) sub = positional[1];

  return { cmd, sub, opts, positional };
}

module.exports = { parse };
