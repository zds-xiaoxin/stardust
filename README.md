<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="assets/brand/stardust-icon.png">
    <img src="assets/brand/stardust-icon-animated.svg" width="128" height="128" alt="星尘 Agent 图标">
  </picture>
</p>

<h1 align="center">星尘 Agent</h1>

<p align="center">
  <strong>面向 Mac 和 Windows 的双语 AI 桌面工作台</strong><br />
  在同一扇窗里切换智能体、查看账号额度、批注预览，并找回会话产物。
</p>

<p align="center">
  <a href="https://www.xiaoxin666.cn/stardust"><strong>产品官网与积木工坊</strong></a> ·
  <a href="#download">下载 v1.2.9</a> ·
  <a href="https://github.com/zds-xiaoxin/stardust-legacy/releases">历史版本 / Older releases</a> ·
  <a href="#release-highlights">v1.2.9</a> ·
  <a href="#highlights">核心亮点</a> ·
  <a href="#workshop">星尘积木工坊</a> ·
  <a href="#updates-privacy">更新与隐私</a> ·
  <a href="README.en.md"><strong>English</strong></a>
</p>

---

<a id="release-highlights"></a>

## v1.2.9 应用内更新修复

macOS 和 Windows 下载更新时会使用新的暂存目录，避免旧缓存被占用或无法清理时中断下载。

## v1.2.8 稳定性更新

重试回退 Codex 会话时保留导入历史和应保留的轮次。导入会话时保留已保存的标题。Antigravity 回复结束后即使提供方停止输出，任务也能完成。在工作树绑定前发送第一条消息时，任务会等工作树就绪。

## v1.2.7 新版工作台实录

### 在第一条消息前选好工作区

点问候语里的项目名可以换项目。在 Git 项目的输入框底部，选当前检出或新建工作树；选新工作树后还能指定起始分支。

<p align="center"><a href="assets/community/v1.2.6/zh-draft.gif"><picture><source media="(prefers-reduced-motion: reduce)" srcset="assets/community/v1.2.6/zh-draft-still.png"><img src="assets/community/v1.2.6/zh-draft.gif" alt="在第一条消息前选好工作区" width="880"></picture></a></p>

### 下一个账号，什么时候恢复额度？

点顶栏账号胶囊，看短周期和每周额度各剩多少、何时重置。要比较多个账号一周内的安排，在「用量与限额」的七天时间轴点对应行。

<p align="center"><a href="assets/community/v1.2.6/zh-quota.gif"><picture><source media="(prefers-reduced-motion: reduce)" srcset="assets/community/v1.2.6/zh-quota-still.png"><img src="assets/community/v1.2.6/zh-quota.gif" alt="下一个账号，什么时候恢复额度？" width="880"></picture></a></p>

### 先看磁盘，再决定清哪几项

在 macOS 扫描磁盘后，容量条分出「放心清」「看一眼」「只提醒不动」。检查勾选项与抢救设置，最后一次确认会写明直接删除的容量；直接删除的文件无法撤销。

<p align="center"><a href="assets/community/v1.2.6/zh-storage.gif"><picture><source media="(prefers-reduced-motion: reduce)" srcset="assets/community/v1.2.6/zh-storage-still.png"><img src="assets/community/v1.2.6/zh-storage.gif" alt="先看磁盘，再决定清哪几项" width="880"></picture></a></p>

### 把常用会话置顶，把其他会话留待稍后

在会话里按 ⌘K（Windows 用 Ctrl+K），可以置顶、标为已处理，或设置稍后提醒。向内拖动侧栏右边缘可隐藏侧栏，从窗口左边缘可恢复。切换会话时，时间线也能更早显示。

<p align="center"><a href="assets/community/v1.2.6/zh-commands.gif"><picture><source media="(prefers-reduced-motion: reduce)" srcset="assets/community/v1.2.6/zh-commands-still.png"><img src="assets/community/v1.2.6/zh-commands.gif" alt="把常用会话置顶，把其他会话留待稍后" width="880"></picture></a></p>

### 切换工作现场时，保留手头的内容

检出 PR 时保留输入中的草稿。Claude 启动失败且本机原生会话记录缺失时，星尘可用已保存的会话历史接续。GitLab 的下游检查跟随对应主机。终端长粘贴期间的其他输入会等待；工作流可用并发池限制共享步骤同时运行的数量。

<p align="center"><a href="assets/community/v1.2.6/zh-workflow-guide.png"><img src="assets/community/v1.2.6/zh-workflow-guide.png" alt="切换工作现场时，保留手头的内容" width="880"></a></p>

### macOS 全屏时，给系统标题栏留出空间

macOS 原生全屏时，星尘按窗口状态布置顶栏。Windows x64 的工具按钮与系统窗口按钮各占自己的位置。图中为两端的窗口控件局部。

<p align="center"><a href="assets/community/v1.2.6/zh-titlebars.png"><img src="assets/community/v1.2.6/zh-titlebars.png" alt="macOS 全屏时，给系统标题栏留出空间" width="880"></a></p>

---

<a id="highlights"></a>

## 核心亮点与动效实录

以下保留早期版本的操作演示。新版模型选择器使用银河滑块，可选推理档位取决于模型。

### 1. V18「星舰发射栈」流体推理强度滑块（离屏贴图 + 静止 2 秒停止重绘）

每次切换模型推理强度，不再是枯燥的下拉菜单——一艘不锈钢星舰随档位连续演进 5 个高对比视觉阶段：**发射台冷态待命 → 猛禽点火 → Max-Q 音爆破云 → 地球弧线钟形真空羽流 → 深空曲速巡航**，升档自带 180ms 过载打击反馈（2 帧定格、曝光闪、胶囊微震、旋钮反冲、色散与音爆环）与 Liquid Glass 折射放大镜。

- **流畅度优化**：将羽流、激波菱形、星轨、云层与粒子全部预烘焙为离屏精灵贴图（每帧新建的渐变对象从约 120–180 个降到 6 个以内），切档结束静置 **2 秒后自动停止重绘**，鼠标移入、聚焦或拖拽时立即恢复。

<p align="center">
  <img src="assets/community/v1.2.0/demo-starship-slider.gif" alt="V18 星舰发射栈推理强度滑块 5 档连续演进实录" width="92%" />
</p>

### 2. Composer V9 统一输入台与底部「会话概览 / 令牌缓存」弹簧浮层

- **统一模型触发胶囊（输入台右侧）**：显示当前提供方图标、模型名称与推理档位色点；点击向上展开弹窗，依次集成 Spotlight 模型搜索、横向提供方药丸标签、模型列表（含剩余额度）、推理滑块与底部三段式弹性权限滑块（默认「完全访问」不占底栏，切换为「自动 / 需审批」时在模型胶囊左侧显示独立权限芯片）。
- **居中会话统计浮层**：底部悬停磁吸 Dock 药丸顺滑跟手，点击纯合成层弹簧弹出「会话概览」（轮次/步数/速率/思考与工具耗时占比）与「令牌与缓存」（总计/缓存命中读取与命中率）。

<p align="center">
  <img src="assets/community/v1.2.0/demo-composer-stats.gif" alt="底部会话概览与令牌缓存 3 层毛玻璃弹簧弹窗演示" width="92%" />
</p>

### 3. 用量、费用、多账号限额与 macOS 清理中心

- **四分页数据工作台**（费用 / 令牌 / 限额 / 清理与整理）：采用一次性数据动效（数字滚动、曲线绘制、双限额圆环、燃尽预测与前一时段对比），首次打开极速渲染。
- **顶栏常驻额度胶囊**：不用切页面就能随时看清 Claude / Codex 剩余额度与重置倒计时。
- **先预览再执行的磁盘清理（macOS）**：按卷查看占用与受保护项，每一条清理建议都先预览路径和去向，确认后才执行。

<p align="center">
  <img src="assets/community/v1.2.0/demo-usage-dashboard.gif" alt="用量、费用与多账号限额圆环动态可视化" width="92%" />
</p>

### 4. 任务步骤卡、内置预览图钉批注与产物墙

- **任务步骤卡与命令人话描述**：把晦涩终端命令自动折叠成可读步骤卡（如 `跑测试`、`类型检查`），展示耗时与产出数，展开保留原始命令。

<p align="center"><a href="assets/community/v1.2.6/zh-steps.png"><img src="assets/community/v1.2.6/zh-steps.png" alt="任务步骤" width="880"></a></p>

- **预览图钉批注**：在内置浏览器预览里直接点元素钉图钉、按「待改 / 已改」筛选、双向定位，发送给助手时自动附带局部截图。

<p align="center"><a href="assets/community/v1.2.6/zh-annotations.webp"><img src="assets/community/v1.2.6/zh-annotations.webp" alt="预览批注" width="880"></a></p>

- **产物面板**：集中管理当前会话与项目产出的文档、图片和代码文件。

<p align="center"><a href="assets/community/v1.2.6/zh-artifacts.webp"><img src="assets/community/v1.2.6/zh-artifacts.webp" alt="会话产物" width="880"></a></p>


---

<a id="workshop"></a>

## 星尘积木工坊 · 把喜欢的动画装进你自己的工作台

在打磨 V18 流体星舰的过程中，我们还做出了多套风格迥异的高完成度推理滑块方案（**V16 星尘观测站**、**V19-A 16-Bit 街机像素星舰**、**V19-B 赛博机甲 HUD**、**V17 聚变核心 / 日食弹弓 / 星钢淬火**）。

不想拘泥于默认样式？可以在 **[开源小新 · 星尘积木工坊](https://www.xiaoxin666.cn/stardust#workshop)** 在线拖动全部方案试玩，或者打开本仓库的 **[`stardust-kit/`](stardust-kit/README.md)** 目录：每套方案都带一个可直接在浏览器打开的 `demo.html`，以及独立源码和 AI 改造 Prompt，可以装进你自己的工作台。

<p align="center">
  <img src="assets/community/v1.2.0/demo-slider-gallery.gif" alt="星尘积木工坊：V18 流体星舰 / V16 星尘观测站 / V19 像素星舰 / V19 赛博机甲 HUD" width="94%" />
</p>

| 积木方案 | 视觉风格 | 仓库目录 | 在线体验 |
| --- | --- | --- | --- |
| **V18 流体写实星舰** | 工坊可试玩 · 连续飞行 + 离屏贴图 + 2s 自动休眠 | [`stardust-kit/v18-starship-fluid`](stardust-kit/v18-starship-fluid/) | [demo.html](stardust-kit/v18-starship-fluid/demo.html) |
| **V16 星尘观测站** | 治愈像素叙事 · 小机器人夜间逐件点亮观测站与流星 | [`stardust-kit/v16-stardust-observatory`](stardust-kit/v16-stardust-observatory/) | [demo.html](stardust-kit/v16-stardust-observatory/demo.html) |
| **V19-A 16-Bit 像素星舰** | 复古街机高精像素火箭与圆润火焰烟球 | [`stardust-kit/v19-pixel-starship`](stardust-kit/v19-pixel-starship/) | [demo.html](stardust-kit/v19-pixel-starship/demo.html) |
| **V19-B 赛博机甲 HUD** | 高达 / EVA 遥测网格、流体光带尾迹与曲速护盾 | [`stardust-kit/v19-cyber-hud`](stardust-kit/v19-cyber-hud/) | [demo.html](stardust-kit/v19-cyber-hud/demo.html) |
| **V17 高对比实验 4 套** | 星舰 / 聚变核心超频 / 日食引力弹弓 / 星钢淬火 | [`stardust-kit/v17-thrill-experiments`](stardust-kit/v17-thrill-experiments/) | [demo.html](stardust-kit/v17-thrill-experiments/demo.html) |

---

<a id="updates-privacy"></a>

## 更新提醒与隐私说明

### 应用内更新与隐私开关

进入「设置 → 关于」。标准安装支持时，可点「更新并重启」，也可选择后台下载、下次启动使用新版。自行改造的版本可用源码模式查看差异。星尘活跃设备统计有单独开关。

<p align="center"><a href="assets/community/v1.2.6/zh-update.png"><img src="assets/community/v1.2.6/zh-update.png" alt="应用内更新与隐私开关" width="880"></a></p>

若安装方式不支持应用内更新，更新卡会引导你到发行页下载。

### 使用统计与隐私
- **星尘活跃人数（v1.2.1 起，默认开启）**：为了知道有多少人在用，应用每天最多发送一次：随机安装 ID、星尘版本号、系统和芯片类型，发到 `xiaoxin666.cn/api/stardust`。不发送聊天、账号、项目或文件路径；统计库不保存 IP，安装 ID 再次哈希后按天去重，写入时清理超过 90 天的记录。
- 第一次启动新版本会弹出说明，可以直接点「关闭统计」；之后在 **设置 → 关于 →「计入星尘活跃用户」** 随时开关。关闭后不再发送。
- 网站 [xiaoxin666.cn/stardust](https://www.xiaoxin666.cn/stardust) 只公开「近 7 天活跃设备数」一个数字。
- 星尘发行版已关闭上游使用统计。模型请求仍按你选择的服务通道发送。

---

<a id="download"></a>

## 下载与安装

[macOS ARM64 ZIP](https://github.com/zds-xiaoxin/stardust/releases/download/v1.2.9/Stardust-v1.2.9-macOS-arm64.zip) · [Windows x64 Setup](https://github.com/zds-xiaoxin/stardust/releases/download/v1.2.9/Stardust-v1.2.9-Windows-x64-Setup.exe) · [GitHub Releases / SHA256SUMS.txt](https://github.com/zds-xiaoxin/stardust/releases/latest)

### macOS · Apple Silicon

macOS 13 及以上。将 ZIP 的 SHA-256 与同一发行页的校验值对照后，解压并把应用移入「应用程序」。

<p align="center"><a href="assets/community/v1.2.6/zh-install-mac.png"><img src="assets/community/v1.2.6/zh-install-mac.png" alt="macOS · Apple Silicon" width="880"></a></p>

在下载目录运行以下命令，把结果与同一发行页中 ZIP 对应的 64 位校验值逐字对照。

```sh
shasum -a 256 Stardust-v1.2.9-macOS-arm64.zip
```

切换已有安装前，等运行中的任务结束，退出桌面应用并备份本地数据。首次启动后连接已登录的智能体 CLI。

### Windows · x64

Windows 10/11 x64 测试版。核对 SHA-256 后运行安装程序。如遇 SmartScreen，选择「更多信息 → 仍要运行」。若组织策略阻止运行，请停止安装。

<p align="center"><a href="assets/community/v1.2.6/zh-install-win.png"><img src="assets/community/v1.2.6/zh-install-win.png" alt="Windows · x64" width="880"></a></p>

在下载目录用 PowerShell 计算校验值，对照同一份清单中的 EXE 条目。

```powershell
(Get-FileHash Stardust-v1.2.9-Windows-x64-Setup.exe -Algorithm SHA256).Hash
```

[Windows 安装与校验说明](docs/user/stardust-windows-install.md)

---

## 致谢与许可

<img src="assets/community/v1.2.6/author.png" width="56" height="56" alt="开源小新">

星尘 Agent 是由**开源小新**和贡献者维护的独立项目，采用 [MIT 许可](LICENSE)。项目来源、版权与第三方组件见 [NOTICE](NOTICE.md)。星尘 Agent 的问题请在[本仓库](https://github.com/zds-xiaoxin/stardust/issues)反馈。
