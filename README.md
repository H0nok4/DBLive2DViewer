# Daiblos Spine Observatory

面向 [bungaku-moe/DaiblosCoreAssets](https://github.com/bungaku-moe/DaiblosCoreAssets) 的 Spine 3.8 预览网站。界面参考 Brown Dust 2 L2D Viewer 的核心使用方式，并针对大量素材设计为素材库、舞台和控制台三栏布局。

## 功能

- 内置 435 个目录、655 个 Spine 骨架的资源索引
- 本地仓库优先；文件不存在时自动回退到 GitHub Raw
- 自动修复仓库中 atlas 声明尺寸、实际 PNG 尺寸及边界坐标不一致导致的加载中断
- 动画和皮肤切换、循环、暂停、0.1×–2× 播放速率
- 当前动画图层搜索、逐项显隐和 Effect 背景/前景分组控制
- 自动识别服装、附件和颜色状态动画，可保持后叠加到其他动作并随链接分享
- 拖拽、滚轮缩放、水平翻转、骨骼调试和全屏
- 多关键词搜索、素材分类和 URL 状态分享
- 桌面三栏与移动端抽屉式响应布局

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:4173/`。

## 下载或更新完整素材仓库

```bash
npm run assets:sync
```

素材会下载到项目根目录的 `DaiblosCoreAssets/`。该目录已加入 `.gitignore`，不会被误提交到预览器仓库。

首次同步约需 3.85 GiB。同步器使用轻量 Git 元数据记录上游 commit，逐文件并发下载并按 GitHub 文件大小校验；中途中断后再次执行同一命令会跳过已经完整的文件，只补齐缺失部分。后续执行则会拉取上游更新。

开发或预览服务器会通过 `/daiblos-assets/` 读取本地文件，页面顶部显示 `LOCAL DISK`。只有本地文件不可用时才会显示 `REMOTE` 并切换到远程源。

## 构建

```bash
npm run build
npm run preview
```

## 更新资源索引

上游仓库新增模型后执行：

```bash
npm run generate:manifest
```

脚本会通过 GitHub Tree API 重新生成 `src/data/assets.generated.json`。

## 部署

Vite 使用相对 `base`，可部署到 GitHub Pages、Cloudflare Pages 或 Netlify。执行下面的命令会先构建网站，再将 `dist/` 发布到远程仓库的 `gh-pages` 分支：

```bash
npm run deploy
```

GitHub Pages 的发布源需要设置为 `gh-pages` 分支根目录。

静态部署不会携带本地 3.85 GiB 素材，会按需从
[`bungaku-moe/DaiblosCoreAssets`](https://github.com/bungaku-moe/DaiblosCoreAssets)
的 GitHub Raw 地址读取当前模型资源。

## 说明

本项目只提供资源索引与预览能力。游戏素材版权归原权利人所有，请遵守上游仓库及相关权利人的使用要求。
