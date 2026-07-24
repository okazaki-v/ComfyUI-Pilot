<div align="center">

# ComfyPilot

**ComfyUI 桌面驾驶舱 —— 放大是沉浸式工作区，收起是实时任务监控**

Electron · React · TypeScript · Windows

</div>

---

用浏览器跑 ComfyUI 有两个老大难：页面淹没在一堆标签里，切走之后就对任务进度一无所知——只能反复切回来看跑完没有。

ComfyPilot 把这两件事一次解决：

- **工作区模式**：无边框窗口完整承载 ComfyUI 原生前端，零侵入、不魔改页面，比浏览器更沉浸；
- **监控模式**：窗口收进系统托盘后，任务进度实时同步到任务栏、托盘和置顶悬浮窗；**队列全部完成时亮起绿光、播放提示音、弹出系统通知**——放心切走干别的，跑完了它会叫你。

## 功能一览

### 🖥️ 工作区

- 无边框沉浸式外壳，自绘标题栏，窗口位置与状态记忆
- 内嵌 ComfyUI 原生前端，节点编辑体验与浏览器完全一致，登录态持久化
- **多服务器**：添加多个 ComfyUI 地址（本机/局域网），标题栏标签一键切换，页面常驻切换零等待
- 断线自动重连（指数退避），标题栏状态灯：绿 = 已连接 / 琥珀 = 连接中 / 红 = 重连中
- **任务侧边栏**：当前任务卡片（进度 + 实时预览 + 中断）、等待队列（单项取消/清空）、最近报错（一键复制）、历史记录（输出缩略图，点击看大图）

### 📊 监控

- **任务栏**：图标进度条实时显示整体进度，角标标记执行中/完成/出错
- **托盘**：四态图标（空闲/执行中/完成绿光呼吸/出错），悬停查看详情（`执行中 42% · KSampler 14/30 · 队列剩 2`），右键快捷操作
- **迷你悬浮窗**：置顶小卡片实时显示进度、当前节点步数、耗时与**生成过程预览图**；可拖动、双击回主窗
- **完成提醒**：绿光 + 提示音 + Windows 通知 + 任务栏闪烁，查看后自动复位；出错时红光 + 低音提示
- 任务从哪个客户端提交都能监控到（包括其他浏览器和 API 调用）
- 全局快捷键显示/隐藏窗口（默认 `Ctrl+Alt+C`）

### ⚙️ 设置中心

服务器管理 · 提示音开关 · 提醒时机（每任务 / 仅队列完成）· 关闭按钮行为 · 悬浮窗开关 · 开机自启 · 快捷键自定义 —— 全部即时生效

## 快速开始

前置：已运行的 ComfyUI 服务（本机或局域网）、Node.js ≥ 20。

```powershell
git clone https://github.com/<你的用户名>/comfy-pilot.git
cd comfy-pilot
npm install
npm run dev
```

首次启动填入 ComfyUI 地址（默认 `http://127.0.0.1:8188`）即可。

> 国内网络建议先配置镜像：
> ```powershell
> npm config set registry https://registry.npmmirror.com
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
> ```

## 打包

```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

产物在 `dist/`：NSIS 安装包 + 便携版 exe。

## 快捷键

| 快捷键 | 作用 |
|---|---|
| `Ctrl+Alt+C`（可自定义） | 全局显示/隐藏窗口 |
| `F5` | 刷新工作区 |
| `F11` | 全屏 |
| `Ctrl+滚轮` | 缩放工作区（记忆比例） |
| `Ctrl+Shift+I` | 工作区开发者工具 |

## 架构要点

```
src/
  main/                 # 主进程：一切状态的唯一持有者
    taskmonitor.ts      #   任务状态机（三路事件源 + 轮询兜底）
    connection.ts       #   服务器连通性探测与自动重连
    comfyapi.ts         #   ComfyUI HTTP API 封装
    preview.ts          #   WebSocket 二进制预览帧解析
    tray.ts / icons.ts  #   托盘与程序化图标绘制
    settings.ts         #   设置持久化与版本迁移
  preload/
    index.ts            #   外壳/悬浮窗 API 桥（contextBridge）
    comfy.ts            #   注入 ComfyUI 页面的 WebSocket 转发器
  renderer/src/         # 外壳 UI（React）：标题栏 / 侧边栏 / 设置 / 悬浮窗
scripts/gen-icon.mjs    # 程序化生成应用图标（手写 PNG/ICO 编码，零素材依赖）
```

几个值得一提的设计决策：

- **三路监控合并**。ComfyUI 服务端只把执行事件发给提交任务的那个客户端，单开一条 WebSocket 是监控不到别人的任务的。ComfyPilot 同时使用：① 自建 WS 连接收广播队列数；② 向内嵌页面注入转发器，拦截其 WebSocket 拿到本工作区任务的全量事件与预览帧；③ `/queue` + `/history` 轮询兜底，保证任何来源的任务都能正确判定完成与出错，状态永不卡死。
- **主进程持有一切状态**，窗口只是显示器——外壳、悬浮窗随时销毁重建，监控在后台照常运转；渲染进程挂载时先订阅再拉取快照，杜绝启动竞态。
- **零素材资源**：托盘四态图标与应用图标全部程序化绘制（含绿光辉光的逐像素渲染），提示音用 WebAudio 现场合成，仓库里没有一张图片、一个音频文件。
- **图片代理协议**：侧边栏缩略图经 `comfy-img://` 自定义协议由主进程转发，绕开渲染进程跨源限制，也为远程服务器鉴权预留了统一入口。

## License

[MIT](LICENSE)
