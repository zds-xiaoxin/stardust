# 星尘界面规范 · Stardust UI Standards (skills)

> **中文** · [English](#english)

四个可发布的技能（Skill），帮助任何人或 AI 助手保持界面设计一致。内容是纯 Markdown 加少量脚本，不绑定任何厂商：
Claude Code、Codex、Gemini / Antigravity 都能用，也可以直接当文档读。随 Stardust（星尘，MIT 许可）开源，动效规范由星尘项目撰写。

| 技能 | 一句话 | 通用性 | 内容 |
|---|---|---|---|
| [`stardust-motion-audit/`](stardust-motion-audit/SKILL.md) | 按「状态变化」审计并统一动效：出现/消失、移动、尺寸、内容/图标/数字变化、按下/悬停、加载/完成/出错。含 7 个动效 token、状态清单模板、曲线统计、慢放、性能（长任务/掉帧/CLS）脚本。 | 通用，任何 Web UI | `SKILL.md` · `references/` · `scripts/` |
| [`ui-screenshot-matrix/`](ui-screenshot-matrix/SKILL.md) | 验收截图：中英 × 深浅 × 桌面 1440/窄屏 900/手机 390，整页与关键状态，滚动录屏，改前改后对比，与原稿的等比例核对。 | 通用 | `SKILL.md` · `references/` · `scripts/` |
| [`stardust-visual-style/`](stardust-visual-style/SKILL.md) | 星尘视觉：配色、星宝吉祥物规则、柔光风格、稿件必须画在真实星尘界面里、官网仅深色，以及主题 v2 实际发布的内容。 | 星尘专用 | `SKILL.md` · `references/` · `assets/`（品牌 SVG） |
| [`stardust-kit-component/`](stardust-kit-component/SKILL.md) | 如何给积木工坊新增组件：目录格式、`demo.html`、中英安装提示词、关键词、诚实的状态标注。 | 星尘专用 | `SKILL.md` · `references/` · `templates/` |

## 安装

阅读规范、使用提示词和模板无需安装依赖。运行截图、录屏或浏览器性能脚本时，请在自己的项目中安装 Playwright，并使用该版本支持的 Node.js。首次安装需要联网。

```sh
npm install --save-dev playwright
npx playwright install chromium
```

若已有 Google Chrome，可跳过 Chromium 下载，用 `PW_CHANNEL=chrome node <脚本路径> …` 启动。录屏还需要 Playwright 对应的 FFmpeg（可用 `npx playwright install ffmpeg` 安装）；导出 MP4 另需系统 `ffmpeg`。已有依赖可设 `PLAYWRIGHT_PATH` 为本机 `node_modules` 的绝对路径。脚本本身在运行时绝不自动下载或安装包；本地模式（含 `proportion-check.mjs` 的本地 HTML）仅从目标根目录经 `https://app.local` 离线响应，其余所有域名与越界路径一律阻断，只有显式传入在线 URL 时才会访问该地址。

- **Claude Code**：把需要的技能文件夹复制到 `~/.claude/skills/`（个人）或项目的 `.claude/skills/`。每个文件夹里的 `SKILL.md` 带 `name` 与 `description`，会按触发词自动加载。
- **Codex、Antigravity 与 Gemini CLI**：把每个技能的完整文件夹复制到项目的 `.agents/skills/`。例如从本套件根目录执行下面两行，把路径换成目标项目。三个工具可共用同一份。重新打开项目后，在 Codex 的技能列表、Antigravity 的 `/skills` 或受信项目中的 `gemini skills list --all` 核对这四项。

```sh
mkdir -p "/path/to/project/.agents/skills"
cp -R skills/stardust-motion-audit skills/ui-screenshot-matrix skills/stardust-visual-style skills/stardust-kit-component "/path/to/project/.agents/skills/"
```

- **任何其他工具**：把 `SKILL.md` 当作提示词读给助手，`references/` 和 `scripts/` 按相对路径引用。

写法约定：`SKILL.md` 正文用英文并带中文触发词，细节放在 `references/`，每个 `SKILL.md` 不超过约 150 行。

## 许可与署名

MIT。动效标准与 token 由 Stardust 项目撰写，来自[星尘 v1.2.4 的动效定义](https://github.com/zds-xiaoxin/stardust/blob/v1.2.4/apps/web/src/lib/workbenchMotion.ts)。
品牌素材（星宝 T2）为星尘项目自有，同样按 MIT 发布。示例中只用样例数据。

---

<a id="english"></a>

## English

Four publishable skills that help anyone, human or AI agent, keep interface design consistent. They are plain Markdown plus
small scripts with no vendor lock-in: they work in Claude Code, Codex and Gemini / Antigravity, and read fine as documents.
Shipped inside the open-source Stardust project (MIT). The motion standards were authored by the Stardust project.

| Skill | What it is | Scope | Contains |
|---|---|---|---|
| [`stardust-motion-audit/`](stardust-motion-audit/SKILL.md) | Audit and unify motion by **state change**: appear/disappear, move, resize, content/icon/number swap, press/hover, load/complete/error. Seven motion tokens, an inventory template, a curve/duration counter, slow motion, and a performance script (long tasks, frames, CLS). | Generic, any web UI | `SKILL.md` · `references/` · `scripts/` |
| [`ui-screenshot-matrix/`](ui-screenshot-matrix/SKILL.md) | Acceptance captures: zh/en x dark/light x desktop 1440 / narrow 900 / mobile 390, full page and key states, scroll recording, before/after comparison, proportion check against an original (uniform scale only). | Generic | `SKILL.md` · `references/` · `scripts/` |
| [`stardust-visual-style/`](stardust-visual-style/SKILL.md) | Stardust look: palette, the 星宝 mascot rules, soft self-glow style, mockups drawn in the real Stardust shell, dark-only website, and what Theme v2 actually ships. | Stardust-specific | `SKILL.md` · `references/` · `assets/` (brand SVGs) |
| [`stardust-kit-component/`](stardust-kit-component/SKILL.md) | How to add a component to the Block Workshop (积木工坊): folder format, `demo.html`, bilingual install prompts, keywords, honest status badges. | Stardust-specific | `SKILL.md` · `references/` · `templates/` |

### Install

Reading the guides and using their prompts and templates requires no setup. To run browser capture, recording or performance scripts, install Playwright in your project with a Node.js version supported by that Playwright release. The initial download requires internet access.

```sh
npm install --save-dev playwright
npx playwright install chromium
```

With Google Chrome installed, skip the Chromium download and run `PW_CHANNEL=chrome node <script> …`. Recording also needs Playwright’s FFmpeg (`npx playwright install ffmpeg`); MP4 conversion needs `ffmpeg` on your PATH. To reuse another installation, set `PLAYWRIGHT_PATH` to its absolute `node_modules` path. Scripts never install or download packages at runtime; local-file mode (including local HTML in `proportion-check.mjs`) serves strictly within the target root at `https://app.local` and aborts all other origins or out-of-root paths. Passing an explicit live URL accesses that URL.

- **Claude Code:** copy the skill folders to `~/.claude/skills/` (personal) or `.claude/skills/` in a project. Each `SKILL.md`
  has `name` and `description` frontmatter and loads on its trigger phrases.
- **Codex, Antigravity and Gemini CLI:** copy each complete skill folder to the project's `.agents/skills/`. All three can share the same copy. Run the example from the kit root after substituting your project path. Reopen the project and check the Codex skills list, Antigravity’s `/skills`, or `gemini skills list --all` in a trusted Gemini project.

```sh
mkdir -p "/path/to/project/.agents/skills"
cp -R skills/stardust-motion-audit skills/ui-screenshot-matrix skills/stardust-visual-style skills/stardust-kit-component "/path/to/project/.agents/skills/"
```

- **Any other tool:** feed `SKILL.md` to the assistant as a prompt; `references/` and `scripts/` are referenced by relative path.

Convention: `SKILL.md` bodies are in English with Chinese trigger phrases; depth lives in `references/`; each `SKILL.md`
stays around 150 lines or fewer.

### License and attribution

MIT. The motion standards and tokens were authored by the Stardust project and come from the [v1.2.4 motion definitions](https://github.com/zds-xiaoxin/stardust/blob/v1.2.4/apps/web/src/lib/workbenchMotion.ts). The brand assets (mascot 星宝, T2) are the project's own and are
released under MIT as well. Examples use sample data only.
