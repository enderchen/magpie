# 纸鹊 Magpie：npm 打包与后续发布

当前包名 `magpie`，命令 `magpie`，版本由 package.json 管理。npm 包尚未发布。`private: true` 阻止误发布，不影响本地打包安装，也不改变 GitHub 可见性。

## 本地制作

在源码目录执行：

```bash
npm ci
npm run lint
npm test
npm pack
```

`prepack` 自动构建前端。package.json 的 files 清单只包含运行所需代码、静态资源、模板、Skill、环境变量示例和许可文档；实际 .env、数据、账号、日志、测试及插件工程不得进入包。

安装已审核的本地压缩包：

```bash
npm install -g ./magpie-1.6.7.tgz
magpie --help
```

配置 `MAGPIE_BASE` 和 `MAGPIE_TOKEN`，或使用 `--base` / `--token`。默认地址为 `http://localhost:8858`。也可在源码目录用 `npm link` 注册命令。

运行网页服务请在源码目录设置环境变量并执行 `npm start`；或设置 `MAGPIE_DATA_DIR` 指向可写的持久数据目录后运行包内 server.js。配置必须与实际部署一致。

## 发布前需要完成

1. 确认 npm 账号及 `magpie` 名称的实际发布权限。未找到公开包不等于已取得名称所有权。
2. 确认版本号、公开范围及发布内容，复核包中没有账号、Token、数据库或上传文件。
3. 在获得正式发布授权后移除 `private: true`，重新通过检查并审核 tarball，再手动发布该 tarball。
4. 发布成功后验证 registry 元信息及全新安装，再把用户安装说明改为 registry 命令。

本次不配置 NPM_TOKEN、不执行 npm publish、不创建发布标签。GitHub 的 Prepare npm package 工作流只能手动触发，执行验证和打包并保存构建产物，**不发布 npm**。

CLI 的 update 命令在 private 为 true 时只显示源码更新说明。将来启用发布后，它从 package.json 读取本项目包名，更新到该名称对应的版本。
