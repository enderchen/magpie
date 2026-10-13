# 纸鹊 Magpie：npm 打包与后续发布

发布候选为 `@enderchen/magpie@1.6.7`，命令仍为 `magpie`。版本由 package.json 管理，npm 包尚未发布。候选已移除 `private: true`，通过 `publishConfig` 指定公开访问和官方 registry；准备包不等于已发布。登录、双重认证和账号权限由维护者确认，发布必须另行获得明确授权。

## 本地制作

在源码目录执行：

```bash
npm ci
npm run lint
npm test
npm pack
```

`prepack` 自动构建前端。package.json 的 files 清单只包含运行所需代码、静态资源、模板、Skill、环境变量示例和许可文档；实际 .env、数据、账号、日志、测试及插件工程不得进入包。首页使用的动画与图片须保留，其他设计草稿、预览视频及个人路径说明不打包。

源码依赖使用 `package-lock.json`。被安装包自己的 `overrides` 不生效，因此 Mermaid 的纯 JavaScript 依赖随包携带，保留已验证的 KaTeX 版本；会话存储复用本项目的 SQLite 驱动，不再安装第二条旧原生驱动依赖链。更新依赖后必须重新制作 tarball，在独立目录正常安装并执行 `npm audit --omit=dev`，检查实际依赖版本；源码扫描通过不能代替分发包验收。

构建从 Mermaid 的 core 入口生成 `/vendor/mermaid-safe.js`，明确使用本项目的 KaTeX，同时将随包 Mermaid 清单的 KaTeX 范围对齐；不使用上游预打包的旧 KaTeX。旧默认入口转向安全构建，Markdown 模板使用新的资源地址。升级后须回归普通图表和包含公式的图表。

`magpie version bump --type patch --yes --dry-run` 只校验和展示变更计划，不写文件或执行 Git 操作。正式版本升级仍须明确授权；该命令用于完整源码目录，npm 安装包不包含发布工程文件。

安装已审核的本地压缩包：

```bash
npm install -g ./enderchen-magpie-1.6.7.tgz
magpie --help
```

配置 `MAGPIE_BASE=https://magpiesend.site` 和你自己的 `MAGPIE_TOKEN`，或使用 `--base` / `--token`。自托管时改为自己的服务根地址，不加 `/mcp`。默认地址为 `http://localhost:8858`。也可在源码目录用 `npm link` 注册命令。

正式发布后可运行 `npm install -g @enderchen/magpie@1.6.7`。Codex 的 stdio MCP 入口为已安装的 `magpie mcp`（GUI 找不到命令时填写 magpie 的绝对路径），环境变量与 CLI 相同；HTTP MCP 地址为 `https://magpiesend.site/mcp`，使用个人 API Token。Skill 可用 `magpie skill install --dir ~/.agents/skills/magpie` 安装到 Codex 的技能目录，目标目录由使用者决定。

运行网页服务请在源码目录设置环境变量并执行 `npm start`；或设置 `MAGPIE_DATA_DIR` 指向可写的持久数据目录后运行包内 server.js。配置必须与实际部署一致。

MCP 默认只接受本机 Host；远程部署须用 `APP_URL` 设置实际服务域名，或用 `MCP_IP` 设置受信主机名。浏览器 Origin 必须与服务来源一致；无 Origin 的标准 MCP 客户端仍可调用。

## 登录后确认与正式发布

1. 维护者在本机自行执行 `npm login --registry=https://registry.npmjs.org/`，完成浏览器登录和双重认证，不把密码、授权码或验证码交给自动化。
2. 用 `npm whoami --registry=https://registry.npmjs.org/` 确认实际 npm 用户名。登录邮箱不是 scope；必须拥有 `enderchen` 个人 scope，或该组织 scope 的发布权限。若用户名不同，先确认 scope 授权，不擅自改包名。
3. 确认 `@enderchen/magpie@1.6.7` 未发布，并复核 tarball 清单及 SHA-256。同一版本已发布时不得覆盖或重用；任何版本或名称变化须重新准备、检查并授权。
4. 另行获得正式发布授权后，在 tarball 所在目录发布**已审核的包**，不临时重打包：

   ```bash
   npm publish ./enderchen-magpie-1.6.7.tgz --access public --registry=https://registry.npmjs.org/
   ```

   双重认证仍由维护者操作。发布失败或结果不明时先检查 registry，不能直接重复发布。
5. 发布成功后查询 registry 名称、版本、dist integrity 与访问范围；全新目录从 registry 安装，验证 `magpie --version`、CLI、MCP 和 Skill 资产，再更新“尚未发布”的安装说明。

本次仅准备，不配置 NPM_TOKEN、不执行 npm publish、不创建发布标签。GitHub 的 Prepare npm package 工作流只能手动触发，执行验证和打包并保存构建产物，**不发布 npm**。

CLI 的 update 从 package.json 读取 `@enderchen/magpie`，只查询和更新该 scope 的包，不访问无 scope 的同名第三方包。首次发布前 registry 查询可能返回 E404；这不是 tarball 安装失败。`--check` 仅查询，不安装。
