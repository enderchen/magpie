# 小楼网页动画 · 首段预览

日期：2026-09-21。独立预览，原首页未改。

地址：http://localhost:8858/logo-exploration/magpie-house-scene/animation.html?v=4

## 实现

原生 HTML/CSS、SVG 关节层、复用本地 GSAP；没有视频元素，没有视频导出依赖。背景净版由内置 imagegen 基于已确认场景 v2 去除纸鹊和纸张生成。喜鹊按确认造型手工重建 SVG，属于可动候选，非原插画像素级拆层。头、眼睛、尾羽、两翼、两脚和包独立控制。世界坐标脚步用于台阶，前景栏杆独立覆盖。

17 秒范围：0–2.2 接件；2.2–4.6 HTML 变网页及链接；4.6–7.5 走向楼梯；7.5–12.6 上楼；12.6–14 走向首间房；14–17 链接送达。支持暂停、播放、重播、手动进度与可选重复预览。页面隐藏和场景离开可视区暂停；减少动态效果偏好默认不自动播放。

## 验证

- Node 语法检查通过；项目 ESLint 对新增动作脚本检查通过。
- 现有 8858 服务返回独立预览 HTTP 200。
- 真实 IAB 浏览器检查 0、3.3、9.3、15.8 秒，修复图层 opacity 被样式覆盖、台阶线路和栏杆白块遮挡。
- 暂停和进度拖动有效；末尾 16.8 秒开启播放及循环后，观察到时间重新进入 9.6 秒，循环可用。
- 320/375/414/768 宽度无横向溢出，按钮高度 42px；1280 宽度也无溢出。手机完整场景细节仍偏小，正式首页需另做简化构图。
- 浏览器采集无 error 日志。
- 减少动态效果与离屏暂停已实现，未模拟系统偏好变化，未声称完成该项行为验收。

## 当前边界

客户与三位住户目前仍为背景中的静态人物；链接通过移动卡片及送达提示表达，住户伸手、打开网页的角色动作尚未完成。三房间完整派送与下楼回程尚未实现；“循环预览”只是首段从头重播，不是完整无缝故事循环。尚待用户审阅可动喜鹊造型与动作节奏。

## 背景净版提示词

Precise production background clean-plate edit of this approved illustration for web animation. Preserve exact 1536x1024 composition, all architecture staircase balcony floor sparse railings, 3 upstairs people devices and furniture, downstairs male customer glasses hair clothes pose and extended empty right hand. Remove ONLY the green magpie courier completely including cap wings feet tail blue bag and its cast shadow, and remove the HTML paper from customer's extended hand. Reconstruct the unobstructed pale pavement and counter behind removed bird seamlessly. Customer right hand remains extended naturally EMPTY, with existing fingers intact. Do not move or rescale anything. No new elements no text no bird no floating paper no arrows. Preserve same illustration style colors crisp outlines. Full landscape image matching reference geometry.
