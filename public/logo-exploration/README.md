# 纸鹊 Logo · 三方向初稿

预览：http://localhost:8858/logo-exploration/index.html

用户要求使用 huashu-design 设计新 Logo，颜色风格与已确认首页一致。此目录独立存在，未替换 public/index.html、home-share、home-brainfish 或 home-concept 中的内容。

## 交付
- index.html：三版并排比较，点击「放入导航」切换顶部标志。
- a.html：A 折页成帆，编辑式排版与纸页展开的构成。
- b.html：B 页面之 P，沿用既有首页参考站的视觉语法，采用字母轮廓及帆的负空间。
- c.html：C 一纸轻舟，借鉴减法与材料语义的思考方式，以纸舟呼应品牌名。
- assets/a.png、b.png、c.png：生成式图形初稿；不是最终矢量资产，存在轻微生成纹理和色值误差。
- previews/：真实 Chrome 浏览器截图，包括三版桌面、手机及比较页。
- brand-spec.md、product-facts.md：品牌依据与设计边界。

## 验证（2026-09-20）
- 四个页面均在当前本地服务中打开，图片与字体加载可用。
- 浏览器实看三份桌面稿、390px 手机布局；未发现横向溢出（document scrollWidth 不超过 innerWidth）。
- 三份移动菜单都能展开，导航指向既有首页对应板块及登录入口。
- 比较页 A/B/C 三种切换通过。最初内联脚本被站点 CSP 限制，已改为本站外部 preview.js，未修改安全策略。
- 手机文字检查并将 B/C 中两处过小说明调整为 12px。
- 最终比较页浏览器工具未返回错误日志。
- 此任务仅增加独立设计预览；未运行后端回归测试，未改业务逻辑，未推送或发布。

## 待选定后
根据用户选择精修图形、制作正式 SVG、单色及反白版本和站点图标，再接入指定的新首页。当前未获得方向选择，不创建 direction-approved.md，不替换原有标志。
