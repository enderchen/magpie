// rm 命令：删除文件。后端：DELETE /api/files/:id。不可撤销。

const { out, err } = require('./_shared');

async function run(client, args, { exit }) {
  const id = args.sub;
  if (!id) {
    const e = new Error('用法：magpie rm <id> --yes');
    e.name = 'UsageError';
    throw e;
  }
  // 自动化客户端与交互终端使用相同的显式删除确认。
  if (!args.opts.yes) {
    err(`未删除文件 #${id}。此操作不可撤销，请加 --yes 确认删除。\n`);
    (exit || ((c) => { process.exitCode = c; }))(1);
    return;
  }
  await client.del(`/api/files/${id}`);
  out(`✓ 已删除 #${id}\n`);
}

module.exports = { run };
