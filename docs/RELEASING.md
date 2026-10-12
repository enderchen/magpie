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

源码依赖使用 `package-lock.json`。被安装包自己的 `overrides` 不生效，因此 Mermaid 的纯 JavaScript 依赖随包携带，保留已验证的 KaTeX 版本；会话存储复用本项目的 SQLite 驱动，不再安装第二条旧原生驱动依赖链。更新依赖后必须重新制作 tarball，在独立目录正常安装并执行 `npm audit --omit=dev`，检查实际依赖版本；源码扫描通过不能代替分发包验收。

构建从 Mermaid 的 core 入口生成 `/vendor/mermaid-safe.js`，明确使用本项目的 KaTeX，同时将随包 Mermaid 清单的 KaTeX 范围对齐；不使用上游预打包的旧 KaTeX。旧默认入口转向安全构建，Markdown 模板使用新的资源地址。升级后须回归普通图表和包含公式的图表。

`magpie version bump --type patch --yes --dry-run` 只校验和展示变更计划，不写文件或执行 Git 操作。正式版本升级仍须明确授权；该命令用于完整源码目录，npm 安装包不包含发布工程文件。

安装已审核的本地压缩包：

```bash
npm install -g ./magpie-1.6.7.tgz
magpie --help
```

配置 `MAGPIE_BASE` 和 `MAGPIE_TOKEN`，或使用 `--base` / `--token`。默认地址为 `http://localhost:8858`。也可在源码目录用 `npm link` 注册命令。

运行网页服务请在源码目录设置环境变量并执行 `npm start`；或设置 `MAGPIE_DATA_DIR` 指向可写的持久数据目录后运行包内 server.js。配置必须与实际部署一致。

MCP 默认只接受本机 Host；远程部署须用 `APP_URL` 设置实际服务域名，或用 `MCP_IP` 设置受信主机名。浏览器 Origin 必须与服务来源一致；无 Origin 的标准 MCP 客户端仍可调用。

## 发布前需要完成

1. 确认 npm 账号及 `magpie` 名称的实际发布权限。未找到公开包不等于已取得名称所有权。
2. 确认版本号、公开范围及发布内容，复核包中没有账号、Token、数据库或上传文件。
3. 在获得正式发布授权后移除 `private: true`，重新通过检查并审核 tarball，再手动发布该 tarball。
4. 发布成功后验证 registry 元信息及全新安装，再把用户安装说明改为 registry 命令。

本次不配置 NPM_TOKEN、不执行 npm publish、不创建发布标签。GitHub 的 Prepare npm package 工作流只能手动触发，执行验证和打包并保存构建产物，**不发布 npm**。

CLI 的 update 命令在 private 为 true 时只显示源码更新说明。将来启用发布后，它从 package.json 读取本项目包名，更新到该名称对应的版本。
