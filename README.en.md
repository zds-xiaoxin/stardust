<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="assets/brand/stardust-icon.png">
    <img src="assets/brand/stardust-icon-animated.svg" width="128" height="128" alt="Stardust Agent icon">
  </picture>
</p>

<h1 align="center">Stardust Agent</h1>

<p align="center">
  <strong>A bilingual AI desktop workbench for Mac and Windows</strong><br />
  Switch agents, check account limits, annotate a preview and find your outputs in one window.
</p>

<p align="center">
  <a href="https://www.xiaoxin666.cn/stardust/en/"><strong>Website & Interactive Workshop</strong></a> ·
  <a href="#download">Download v1.2.8</a> ·
  <a href="https://github.com/zds-xiaoxin/stardust-legacy/releases">历史版本 / Older releases</a> ·
  <a href="#release-highlights">v1.2.8</a> ·
  <a href="#highlights">Highlights</a> ·
  <a href="#workshop">Stardust Kit</a> ·
  <a href="#updates-privacy">Updates & Privacy</a> ·
  <a href="README.md"><strong>中文</strong></a>
</p>

---

<a id="release-highlights"></a>

## Stability fixes in v1.2.8

Retrying a Codex rewind retains imported history and the intended turns. Imported sessions keep their saved titles. Antigravity tasks can complete when the provider goes silent after its final reply. A first send can wait for its worktree to be ready.

## Inside Stardust v1.2.7

### Choose a workspace before sending

The project name in the greeting opens the project picker. In a Git project, use the controls below the composer to work in the current checkout or start a new worktree from a branch you choose.

<p align="center"><a href="assets/community/v1.2.6/en-draft.gif"><picture><source media="(prefers-reduced-motion: reduce)" srcset="assets/community/v1.2.6/en-draft-still.png"><img src="assets/community/v1.2.6/en-draft.gif" alt="Choose a workspace before sending" width="880"></picture></a></p>

### When does this account reset?

Click an account in the top bar to see the remaining quota and reset time for each reported window. To compare accounts across the week, open Usage & limits and select a row on the seven-day timeline.

<p align="center"><a href="assets/community/v1.2.6/en-quota.gif"><picture><source media="(prefers-reduced-motion: reduce)" srcset="assets/community/v1.2.6/en-quota-still.png"><img src="assets/community/v1.2.6/en-quota.gif" alt="When does this account reset?" width="880"></picture></a></p>

### See what is taking up space

Scan a Mac volume to see what is safe to clean, what needs a closer look and what is only flagged. Review the selection and rescue setting. The final dialog shows how much will be deleted directly and warns when that deletion is irreversible.

<p align="center"><a href="assets/community/v1.2.6/en-storage.gif"><picture><source media="(prefers-reduced-motion: reduce)" srcset="assets/community/v1.2.6/en-storage-still.png"><img src="assets/community/v1.2.6/en-storage.gif" alt="See what is taking up space" width="880"></picture></a></p>

### Pin a thread or come back to it later

Press ⌘K (Ctrl+K on Windows) in a thread to pin, settle or snooze it. Drag the right edge inward to hide the sidebar, then use the left window edge to bring it back. The timeline also appears sooner when switching threads.

<p align="center"><a href="assets/community/v1.2.6/en-commands.gif"><picture><source media="(prefers-reduced-motion: reduce)" srcset="assets/community/v1.2.6/en-commands-still.png"><img src="assets/community/v1.2.6/en-commands.gif" alt="Pin a thread or come back to it later" width="880"></picture></a></p>

### What carries over when you switch

Checking out a pull request keeps your unsent draft. After a failed Claude start, Stardust can continue the conversation from its saved history if the native transcript is missing. Downstream GitLab checks follow the correct host. Large terminal pastes finish before other input is written. Workflow pools limit how many runs can use a shared step at once.

<p align="center"><a href="assets/community/v1.2.6/en-workflow-guide.png"><img src="assets/community/v1.2.6/en-workflow-guide.png" alt="What carries over when you switch" width="880"></a></p>

### Window controls on Mac and Windows

On macOS the title bar adapts to native fullscreen. On Windows x64 the workbench controls leave room for the system caption buttons. The image shows a detail from each platform.

<p align="center"><a href="assets/community/v1.2.6/en-titlebars.png"><img src="assets/community/v1.2.6/en-titlebars.png" alt="Window controls on Mac and Windows" width="880"></a></p>

---

<a id="highlights"></a>

## Highlights & Live Motion Previews

These recordings show the earlier workbench. The current model picker uses the galaxy slider, with effort levels determined by the model.

### 1. V18 "Starship Launch Stack" Effort Slider (Pre-baked Sprite Atlas + 2s Auto-Sleep)

Switch reasoning effort across 5 high-contrast stages of a continuous Starship launch — **Pad standby → Raptor ignition → Max-Q breaking clouds → Earth-limb vacuum plume → Deep-space warp** — complete with 180ms tactile upshift feedback (2-frame hitstop, exposure flash, capsule micro-shake, knob recoil, dispersion & shockwave ring) and a Liquid Glass magnifying capsule.

- **Smoothness work**: Volumetric plumes, Mach diamonds, star streaks, clouds, and batched particles are pre-baked into an offscreen sprite atlas (per-frame gradient objects cut from ~120–180 to 6 or fewer). After **2 seconds of idle** the canvas stops redrawing, and resumes instantly on hover, focus, click, or drag.

<p align="center">
  <img src="assets/community/v1.2.0/demo-starship-slider.gif" alt="V18 Starship Launch Stack 5-stage animated effort slider" width="92%" />
</p>

### 2. Composer V9 & 3-Layer Session / Token Spring Popovers

- **Unified Model Capsule (Right Composer Cluster)**: Displays provider logo, active model name, and effort accent dot/tier; opens an upward popover stacking Spotlight search, horizontal provider pills, model list with remaining quota, the reasoning slider, and a 3-segment sliding permissions footer (default `Full access` stays out of the footer; `Auto` / `Supervised` shows an adjacent chip to the left of the model button).
- **Centered Session Stats Dock**: Magnetic hover pill smoothly tracks between **Session Overview** (rounds, steps, tok/s, model vs tool time split) and **Tokens & Cache** (total tokens, cache read & hit rate) with compositor-only spring popovers.

<p align="center">
  <img src="assets/community/v1.2.0/demo-composer-stats.gif" alt="Composer V9 and 3-layer Session Stats & Token/Cache spring popover" width="92%" />
</p>

### 3. Usage, Cost, Multi-Account Quotas & macOS Cleanup Center

- **4-Tab Analytics Workbench** (Cost / Tokens / Limits / Cleanup): One-shot data animations (rolling numbers, animated trend curves, multi-account quota rings, burndown forecasts, and prior-period comparison) with fast first-open rendering.
- **Persistent Topbar Quota Capsule**: Monitor remaining Claude & Codex windows at a glance without leaving your conversation.
- **Preview-First Disk Cleanup (macOS)**: Inspect per-volume usage, protected directories, and exact removal paths before confirming anything.

<p align="center">
  <img src="assets/community/v1.2.0/demo-usage-dashboard.gif" alt="Usage, cost trend, and multi-account quota rings" width="92%" />
</p>

### 4. Human-Readable Task Step Cards, Preview Pin Annotations & Artifact Wall

- **Task Step Cards**: Turns verbose shell commands into clean step timelines with durations and artifact counts (expand to view raw commands).

<p align="center"><a href="assets/community/v1.2.6/en-steps.png"><img src="assets/community/v1.2.6/en-steps.png" alt="Task steps" width="880"></a></p>

- **Pin Annotations in Built-in Preview**: Click any DOM element to drop a pin, filter by pending/resolved, jump bidirectionally, and attach cropped screenshots automatically.

<p align="center"><a href="assets/community/v1.2.6/en-annotations.webp"><img src="assets/community/v1.2.6/en-annotations.webp" alt="Preview annotations" width="880"></a></p>

- **Artifact Wall**: Browse all generated docs, images, and deliverables per thread or project.

<p align="center"><a href="assets/community/v1.2.6/en-artifacts.webp"><img src="assets/community/v1.2.6/en-artifacts.webp" alt="Thread artifacts" width="880"></a></p>


---

<a id="workshop"></a>

## Stardust Kit · Try & Remix Every Slider Engine

Alongside the **V18 Fluid Starship**, we open-sourced all alternative reasoning slider concepts explored during development — **V16 Stardust Observatory**, **V19-A 16-Bit Pixel Starship**, **V19-B Cyber Mecha HUD**, and **V17 High-Contrast Experiments** (Fusion Reactor / Solar Eclipse / Starsteel Forge).

Try every engine live in the **[Stardust Interactive Workshop](https://www.xiaoxin666.cn/stardust/en/#workshop)**, or open **[`stardust-kit/`](stardust-kit/README.md#english)**: every engine ships a `demo.html` you can open in any browser, plus standalone source code and an AI integration prompt for your own workbench.

<p align="center">
  <img src="assets/community/v1.2.0/demo-slider-gallery.gif" alt="Stardust Kit slider engines running side-by-side" width="94%" />
</p>

| Kit Module | Visual Style | Directory | Live Demo |
| --- | --- | --- | --- |
| **V18 Fluid Starship** | Workshop demo · 5-stage launch + sprite atlas + 2s auto-sleep | [`stardust-kit/v18-starship-fluid`](stardust-kit/v18-starship-fluid/) | [demo.html](stardust-kit/v18-starship-fluid/demo.html) |
| **V16 Stardust Observatory** | Cozy pixel narrative · Midnight robot waking observatory props | [`stardust-kit/v16-stardust-observatory`](stardust-kit/v16-stardust-observatory/) | [demo.html](stardust-kit/v16-stardust-observatory/demo.html) |
| **V19-A 16-Bit Pixel Starship** | Retro hi-bit arcade pixel rocket & fireball plumes | [`stardust-kit/v19-pixel-starship`](stardust-kit/v19-pixel-starship/) | [demo.html](stardust-kit/v19-pixel-starship/demo.html) |
| **V19-B Cyber Mecha HUD** | Telemetry grid, luminous ribbon contrails & warp shield | [`stardust-kit/v19-cyber-hud`](stardust-kit/v19-cyber-hud/) | [demo.html](stardust-kit/v19-cyber-hud/demo.html) |
| **V17 Experiments (4 Themes)** | Starship / Fusion Reactor / Solar Eclipse / Starsteel Forge | [`stardust-kit/v17-thrill-experiments`](stardust-kit/v17-thrill-experiments/) | [demo.html](stardust-kit/v17-thrill-experiments/demo.html) |

---

<a id="updates-privacy"></a>

## Update Alerts & Privacy

### Updates and privacy in Settings

Open Settings → About. Supported standard installs offer Update and restart, with an optional background download for the next launch. Source mode links to changes for custom builds. Active-device counting has its own switch.

<p align="center"><a href="assets/community/v1.2.6/en-update.png"><img src="assets/community/v1.2.6/en-update.png" alt="Updates and privacy in Settings" width="880"></a></p>

When the install cannot self-update, the card links to the GitHub release instead.

### Usage Counting & Privacy
- **Stardust active-user count (v1.2.1+, on by default)**: so the author knows how many people use it, the app sends at most once a day a random install ID, the Stardust version, and the OS and CPU type to `xiaoxin666.cn/api/stardust`. No conversations, accounts, projects or file paths. The counter database stores no IP addresses. It hashes the ID again, counts it once per day and removes records older than 90 days on each write.
- The first launch of the new version shows a notice with a **Turn off** button; you can switch it any time under **Settings → About → "Count me as an active Stardust user"**. Off means nothing is sent.
- [xiaoxin666.cn/stardust](https://www.xiaoxin666.cn/stardust) publishes a single number: devices active in the last 7 days.
- Upstream usage analytics are disabled in the Stardust distribution. Model requests go to the service you select.

---

<a id="download"></a>

## Download & Install

[macOS ARM64 ZIP](https://github.com/zds-xiaoxin/stardust/releases/download/v1.2.8/Stardust-v1.2.8-macOS-arm64.zip) · [Windows x64 Setup](https://github.com/zds-xiaoxin/stardust/releases/download/v1.2.8/Stardust-v1.2.8-Windows-x64-Setup.exe) · [GitHub Releases / SHA256SUMS.txt](https://github.com/zds-xiaoxin/stardust/releases/latest)

### macOS · Apple Silicon

Requires macOS 13 or later. Match the ZIP’s SHA-256 to the same release, then unzip and drag the app to Applications.

<p align="center"><a href="assets/community/v1.2.6/en-install-mac.png"><img src="assets/community/v1.2.6/en-install-mac.png" alt="macOS · Apple Silicon" width="880"></a></p>

Run this in the download folder and match the result against the 64-character digest for the ZIP in the release checksum file.

```sh
shasum -a 256 Stardust-v1.2.8-macOS-arm64.zip
```

Before replacing an existing install, let running tasks finish, quit the desktop app and back up your local data. On first launch, connect your signed-in agent CLI.

### Windows · x64

Windows 10/11 x64 beta. Verify the SHA-256 before running Setup. If SmartScreen appears, select More info → Run anyway. Stop if an organizational policy blocks installation.

<p align="center"><a href="assets/community/v1.2.6/en-install-win.png"><img src="assets/community/v1.2.6/en-install-win.png" alt="Windows · x64" width="880"></a></p>

In the download folder, compute the digest with PowerShell and compare it with the EXE entry in the same checksum file.

```powershell
(Get-FileHash Stardust-v1.2.8-Windows-x64-Setup.exe -Algorithm SHA256).Hash
```

[Windows installation and verification guide](docs/user/stardust-windows-install.md)

---

## Credits & License

<img src="assets/community/v1.2.6/author.png" width="56" height="56" alt="OpenSource Xiaoxin">

Stardust Agent is an independent project maintained by **OpenSource Xiaoxin** and contributors. It is distributed under the [MIT License](LICENSE). See [NOTICE](NOTICE.md) for project origins, copyright and third-party components. Please report Stardust Agent issues in [this repository](https://github.com/zds-xiaoxin/stardust/issues).
