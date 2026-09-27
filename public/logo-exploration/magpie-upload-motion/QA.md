# 上传动作样片 v1

日期：2026-09-20。候选样片，尚待用户审阅；没有修改首页。

## 交付

- `renders/magpie-upload-sample-v1.mp4`：H.264，1536×1024，30 fps，162 帧，5.4 秒，无声，666955 字节。
- Studio：http://localhost:3002/#project/magpie-upload-motion
- `index.html`：SVG 分层与 GSAP 时间线；根据已确认上传分镜重建，非原 PNG 的逐像素动画。
- `renders/qa-contact.png`：1.5、2.7、4.8 秒关键帧，检查翅膀完整、纸张入屏和上传反馈。

## 验证

HyperFrames 0.8.55 check：lint/runtime/motion 均零错误、零警告；9 个采样布局无问题；39/39 文字对比度检查通过。最终视频成功导出并用 ffprobe 核验规格。Studio 播放按钮切换为暂停，播放位置向前推进；预览服务仍运行。

本次只完成上传阶段。生成网页、分享及完整循环尚未制作；样片的矢量画风与动作需先审阅。

## 复现

在此目录运行（使用临时 npm 缓存并关闭遥测）：

```sh
HYPERFRAMES_NO_TELEMETRY=1 npm_config_cache=/private/tmp/magpie-npm-cache npx --yes hyperframes@0.8.55 check
HYPERFRAMES_NO_TELEMETRY=1 npm_config_cache=/private/tmp/magpie-npm-cache npx --yes hyperframes@0.8.55 render --output renders/magpie-upload-sample-v1.mp4 --fps 30 --quality standard --workers 1
```

上述检查和渲染会启动临时浏览器，须遵守工作区浏览器权限规则。Studio 预览使用 3002 端口，首页原服务端口保持不变。
