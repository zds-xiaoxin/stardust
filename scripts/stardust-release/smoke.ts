// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalConsole:off
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeUtil from "node:util";
import type {
  DesktopBridge,
  DesktopUpdateActionResult,
  DesktopUpdateState,
} from "@t3tools/contracts";
import { _electron, type ElectronApplication, type Page } from "playwright-core";

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

const { values } = NodeUtil.parseArgs({
  options: {
    executable: { type: "string" },
    "executable-file": { type: "string" },
    output: { type: "string" },
    version: { type: "string" },
    native: { type: "boolean" },
  },
});
const executable =
  values.executable ??
  (values["executable-file"] ? NodeFS.readFileSync(values["executable-file"], "utf8").trim() : "");
const version = values.version;
NodeAssert.ok(
  executable && version && values.output,
  "Supply an executable, version and output path.",
);
// oxlint-disable-next-line t3code/no-global-process-runtime -- This runner adapter selects native screenshot utilities.
const platform = NodeOS.platform();
NodeAssert.ok(platform === "win32" || platform === "darwin");
const windows = platform === "win32";
const resources = NodePath.resolve(
  NodePath.dirname(executable),
  windows ? "resources" : "../Resources",
);
const repoRoot = NodePath.join(import.meta.dirname, "../..");
const desktopRequire = NodeModule.createRequire(
  NodePath.join(repoRoot, "apps/desktop/package.json"),
);
const builderRequire = NodeModule.createRequire(desktopRequire.resolve("electron-builder"));
const builderLibRequire = NodeModule.createRequire(builderRequire.resolve("app-builder-lib"));
const { flipFuses, FuseV1Options, FuseVersion, getCurrentFuseWire } =
  builderLibRequire("@electron/fuses");
const inspectorFuse = FuseV1Options.EnableNodeCliInspectArguments;
const disabledFuse = "0".charCodeAt(0);
const enabledFuse = "1".charCodeAt(0);

async function preparePlaywrightCopy(directory: string) {
  const original = windows
    ? NodePath.dirname(executable)
    : NodePath.resolve(executable, "../../..");
  const relativeExe = NodePath.relative(original, executable);
  const originalFuseTarget = windows ? executable : original;
  const originalWire = await getCurrentFuseWire(originalFuseTarget);
  NodeAssert.equal(
    originalWire[inspectorFuse],
    disabledFuse,
    "The release app must disable the Node inspector fuse.",
  );

  // Playwright's Electron driver needs the Node inspector even for app launch. Keep the
  // ZIP and installed app unmodified and instrument only a disposable CI application copy.
  const copy = NodePath.join(directory, NodePath.basename(original));
  const copiedExecutable = NodePath.join(copy, relativeExe);
  if (windows) {
    NodeFS.cpSync(original, copy, { recursive: true, force: false, errorOnExist: true });
  } else {
    NodeChildProcess.execFileSync("/usr/bin/ditto", [original, copy]);
  }
  const copyFuseTarget = windows ? copiedExecutable : copy;
  await flipFuses(copyFuseTarget, {
    version: FuseVersion.V1,
    [inspectorFuse]: true,
    resetAdHocDarwinSignature: !windows,
  });
  NodeAssert.deepEqual(await getCurrentFuseWire(copyFuseTarget), {
    ...originalWire,
    [inspectorFuse]: enabledFuse,
  });
  if (!windows) {
    NodeChildProcess.execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", copy]);
  }
  NodeAssert.deepEqual(await getCurrentFuseWire(originalFuseTarget), originalWire);
  console.log("Release inspector fuse verified off. Prepared disposable Playwright copy.");
  return copiedExecutable;
}
for (const name of ["LICENSE", "NOTICE"]) {
  NodeAssert.deepEqual(
    NodeFS.readFileSync(NodePath.join(resources, name)),
    NodeFS.readFileSync(NodePath.join(repoRoot, name)),
    `Packaged ${name} must match the release source.`,
  );
}
const licenseManifest = JSON.parse(
  NodeFS.readFileSync(NodePath.join(resources, "third-party-licenses.json"), "utf8"),
);
NodeAssert.ok(
  Array.isArray(licenseManifest.entries) && licenseManifest.entries.length > 0,
  "The packaged third-party license manifest must contain notices.",
);
const output = NodePath.resolve(values.output);
NodeFS.mkdirSync(output, { recursive: true });
if (values.native)
  NodeAssert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "Native screenshots require the CI desktop.",
  );

const versionParts = version.split(".").map(Number);
const newer = `${versionParts[0]}.${versionParts[1]}.${versionParts[2]! + 1}`;
const assetName = `Stardust-v${newer}-${windows ? "Windows-x64-Setup.exe" : "macOS-arm64.zip"}`;
const payload = Buffer.from("Smoke fixture, not an installer.");
const fakeDigest = NodeCrypto.createHash("sha256")
  .update(Buffer.alloc(payload.length))
  .digest("hex");
const fixtureRelease = {
  tag_name: `v${newer}`,
  name: "Stardust fixture release",
  draft: false,
  prerelease: false,
  assets: [
    { name: assetName, state: "uploaded", size: payload.length, digest: `sha256:${fakeDigest}` },
  ],
};
let fixtureRequests = 0;
const feed = NodeHttp.createServer((request, response) => {
  if (request.url === "/releases/latest") {
    fixtureRequests += 1;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(fixtureRelease));
  } else if (request.url?.endsWith(`/${assetName}`)) {
    response.end(payload);
  } else {
    response.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => feed.listen(0, "127.0.0.1", resolve));
const address = feed.address();
NodeAssert.ok(address && typeof address !== "string");
const fixturePort = String(address.port);

const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "stardust-parity-"));
const fixtureDb = NodePath.join(import.meta.dirname, "../fixtures/desktop-launch/statev2.sqlite");
const workspace = NodePath.join(scratch, "Fixture workspace");
const replay = NodePath.join(import.meta.dirname, "../../apps/server/scripts/dev-replay-agent.ts");
const model = { instanceId: "devReplay", model: "showcase" };

function initializeHome(home: string, seed: boolean) {
  const userdata = NodePath.join(home, "userdata");
  NodeFS.mkdirSync(userdata, { recursive: true });
  // Any fallback title generation gets a local process that fails without a network connection.
  const providerInstances = Object.fromEntries(
    ["codex", "claudeAgent", "cursor", "grok", "muse", "pi", "opencode", "antigravity"].map(
      (driver) => [
        driver,
        {
          driver,
          enabled: false,
          ...(driver === "codex"
            ? { config: { binaryPath: NodePath.join(scratch, "disabled-provider") } }
            : {}),
        },
      ],
    ),
  );
  NodeFS.writeFileSync(
    NodePath.join(userdata, "settings.json"),
    JSON.stringify({
      defaultModelSelection: model,
      enableProviderUpdateChecks: false,
      providerInstances: {
        ...providerInstances,
        devReplay: {
          driver: "acpRegistry",
          displayName: "Release replay",
          config: {
            source: "local",
            commandPath: process.execPath,
            commandArgs: [replay, "--stardust-parity"],
          },
        },
      },
    }),
  );
  NodeFS.writeFileSync(
    NodePath.join(userdata, "client-settings.json"),
    JSON.stringify({ language: "zh" }),
  );
  if (!seed) return;

  const dbPath = NodePath.join(userdata, "statev2.sqlite");
  NodeFS.copyFileSync(fixtureDb, dbPath);
  const db = new NodeSqlite.DatabaseSync(dbPath);
  try {
    db.prepare(
      "UPDATE projection_projects SET workspace_root = ?, default_model_selection_json = ?",
    ).run(workspace, JSON.stringify(model));
    const addDemoThread = db.prepare(`
      INSERT INTO projection_threads (thread_id, project_id, title, created_at, updated_at, model_selection_json)
      SELECT ?, project_id, ?, created_at, updated_at, model_selection_json
      FROM projection_threads WHERE thread_id = 'launch-check-other'
    `);
    addDemoThread.run("launch-check-installation", "Verify installer");
    addDemoThread.run("launch-check-appearance", "Appearance review");
  } finally {
    db.close();
  }
}

async function waitUntil<T>(label: string, read: () => Promise<T | undefined>): Promise<T> {
  const deadline = performance.now() + 60_000;
  do {
    const value = await read();
    if (value !== undefined) return value;
    await NodeTimersPromises.setTimeout(200);
  } while (performance.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}

async function nativeScreenshot(app: ElectronApplication, name: string) {
  if (!values.native) return;
  const destination = NodePath.join(output, `${name}.png`);
  if (windows) {
    const original = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().startsWith("t3code://app/"),
      );
      if (!window) throw new Error("The Stardust window is unavailable.");
      const bounds = window.getBounds();
      window.setBounds(screen.getDisplayMatching(bounds).workArea);
      window.focus();
      return { id: window.id, bounds };
    });
    try {
      NodeChildProcess.execFileSync("pwsh.exe", [
        "-NoProfile",
        "-File",
        NodePath.join(import.meta.dirname, "windows-shell.ps1"),
        "-Action",
        "desktop",
        "-Output",
        destination,
      ]);
    } finally {
      await app.evaluate(({ BrowserWindow }, { id, bounds }) => {
        BrowserWindow.fromId(id)?.setBounds(bounds);
      }, original);
    }
  } else {
    NodeChildProcess.execFileSync("/usr/sbin/screencapture", ["-x", "-t", "png", destination]);
  }
}

const geometry: Record<string, unknown> = {};
const windowsEvidence: Record<string, unknown> = {};
const windowsUpdateChecks = new Map<string, DesktopUpdateActionResult | undefined>();
async function capture(page: Page, name: string) {
  if (windows) {
    const text = await page.locator("body").innerText();
    NodeAssert.doesNotMatch(text, /\bT3\b|星尘 Agent|Stardust Agent/);
  }
  await page.screenshot({ path: NodePath.join(output, `${name}.png`), animations: "disabled" });
  geometry[name] = await page.evaluate(() =>
    Object.fromEntries(
      [
        "[data-app-sidebar]",
        "[data-stardust-hero-mark]",
        '[data-slot="composer-shell"]',
        '[data-testid="composer-editor"]',
        "[data-chat-provider-model-picker]",
        "[data-effort-slider]",
        "[data-panel-layout-controls]",
      ].flatMap((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect && rect.width > 0
          ? [[selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }]]
          : [];
      }),
    ),
  );
}

async function openRoute(page: Page, route: string) {
  await page.evaluate((path) => {
    location.hash = path;
  }, route);
  await page.waitForURL((url) => url.hash === `#${route}`);
}

async function withApp(
  smokeExecutable: string,
  theme: string,
  seed: boolean,
  run: (app: ElectronApplication, page: Page) => Promise<void>,
) {
  const home = NodePath.join(scratch, `${theme}-${seed ? "seeded" : "fresh"}`);
  initializeHome(home, seed);
  console.log(`Launching Playwright copy: ${theme}, ${seed ? "seeded" : "fresh"}.`);
  const app = await _electron.launch({
    executablePath: smokeExecutable,
    args: ["--no-sandbox"],
    env: {
      ...process.env,
      T3CODE_HOME: home,
      T3CODE_ENVIRONMENT_LABEL: "Release fixture",
      T3CODE_DESKTOP_USER_DATA_DIR: NodePath.join(home, "electron-profile"),
      T3CODE_TELEMETRY_ENABLED: "false",
      STARDUST_UPDATE_FIXTURE_PORT: fixturePort,
    },
    timeout: 60_000,
  });
  const child = app.process();
  try {
    const page = await waitUntil("main window", async () =>
      app.windows().find((candidate) => candidate.url().startsWith("t3code://app/")),
    );
    await app.evaluate(({ BrowserWindow, nativeTheme }, mode) => {
      nativeTheme.themeSource = mode as "dark" | "light";
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().startsWith("t3code:"))
        ?.setSize(1280, 800);
    }, theme);
    await page.emulateMedia({ colorScheme: theme as "dark" | "light", reducedMotion: "reduce" });
    await page.evaluate((mode) => {
      localStorage.setItem("t3code:theme-appearance-mode", mode);
      localStorage.setItem(
        "t3code:stardust-stats:v1",
        JSON.stringify({ enabled: false, noticeShown: true }),
      );
    }, theme);
    await page.reload();
    await page.waitForFunction(
      (expected) => document.documentElement.dataset.platform === expected,
      windows ? "windows" : "mac",
    );
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains("dark") === dark,
      theme === "dark",
    );
    if (windows) {
      NodeAssert.equal(
        await page.evaluate(() => window.desktopBridge?.getAppBranding()?.displayName),
        "星尘",
      );
    }
    await run(app, page);
  } catch (cause) {
    const page = app.windows().find((entry) => entry.url().startsWith("t3code://app/"));
    console.error("Fixture page:", page?.url());
    if (page)
      NodeFS.writeFileSync(
        NodePath.join(output, `failure-${theme}.txt`),
        await page
          .locator("body")
          .ariaSnapshot()
          .catch(() => ""),
      );
    await page
      ?.screenshot({ path: NodePath.join(output, `failure-${theme}.png`), timeout: 5_000 })
      .catch(() => {});
    const logs = NodePath.join(home, "userdata/logs");
    if (NodeFS.existsSync(logs))
      NodeFS.cpSync(logs, NodePath.join(output, `logs-${theme}`), { recursive: true });
    throw cause;
  } finally {
    await Promise.race([
      app.close().catch(() => {}),
      NodeTimersPromises.setTimeout(10_000, undefined, { ref: false }),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

async function verifyWindowsProfileIsolation(executablePath: string) {
  const home = NodePath.join(scratch, "isolation-home");
  const appData = NodePath.join(home, "AppData", "Roaming");
  const oldProfile = NodePath.join(appData, "t3code-v2");
  const oldHome = NodePath.join(home, ".t3");
  const newProfile = NodePath.join(appData, "stardust");
  const newHome = NodePath.join(home, ".stardust");
  const migrationMarker = "stardust-v127-migration";
  initializeHome(oldHome, true);
  const launchEnv = {
    ...process.env,
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: NodePath.join(home, "AppData", "Local"),
    T3CODE_TELEMETRY_ENABLED: "false",
    T3CODE_ENVIRONMENT_LABEL: "Release fixture",
    STARDUST_UPDATE_FIXTURE_PORT: fixturePort,
    T3CODE_HOME: undefined,
    T3CODE_PORT: undefined,
    T3CODE_DESKTOP_USER_DATA_DIR: undefined,
  };
  const launch = (env: NodeJS.ProcessEnv) =>
    _electron.launch({ executablePath, args: ["--no-sandbox"], env, timeout: 60_000 });
  const mainWindow = (app: ElectronApplication) =>
    waitUntil("isolated main window", async () =>
      app.windows().find((page) => page.url().startsWith("t3code://app/")),
    );
  const close = async (app: ElectronApplication) => {
    const child = app.process();
    await Promise.race([
      app.close().catch(() => {}),
      NodeTimersPromises.setTimeout(10_000, undefined, { ref: false }),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  };

  const verifySeededThread = async (page: Page) => {
    const thread = page.locator("li[data-thread-item]", { hasText: "Release launch check" });
    const start = page.getByRole("button", { name: /^(Get started|Start|开始|开始使用)$/ });
    const home = page.locator("[data-stardust-hero-mark]");
    await home.or(start).first().waitFor({ timeout: 60_000 });
    if (await start.isVisible()) await start.click();
    await home.waitFor({ timeout: 60_000 });
    if (!(await thread.first().isVisible())) {
      await page
        .getByText(/^(待归类|Uncategorized)$/)
        .first()
        .click();
    }
    await thread.first().waitFor({ timeout: 60_000 });
  };
  const recordFailure = async (label: string, app: ElectronApplication) => {
    const page = app.windows().find((candidate) => candidate.url().startsWith("t3code://app/"));
    if (!page) return;
    await page
      .screenshot({ path: NodePath.join(output, `failure-isolation-${label}.png`), timeout: 5_000 })
      .catch(() => {});
    const log = NodePath.join(appData, "stardust-startup.log");
    if (NodeFS.existsSync(log))
      NodeFS.copyFileSync(log, NodePath.join(output, "isolation-startup.log"));
  };

  // The same executable deliberately holds the old Chromium singleton key.
  // Its backend also continues to own the old state database during the backup.
  const legacy = await launch({
    ...launchEnv,
    T3CODE_DESKTOP_USER_DATA_DIR: oldProfile,
    T3CODE_HOME: oldHome,
  });
  try {
    const legacyWindow = await mainWindow(legacy);
    NodeAssert.equal(await legacy.evaluate(({ app }) => app.getPath("userData")), oldProfile);
    await verifySeededThread(legacyWindow);
    console.log("Legacy lock holder opened the seed thread.");
    await legacyWindow.evaluate(() => localStorage.setItem("stardust-migration-smoke", "legacy"));
    const levelDb = NodePath.join(oldProfile, "Local Storage", "leveldb");
    await waitUntil("legacy Chromium storage flush", async () =>
      NodeFS.readdirSync(levelDb).some(
        (name) =>
          /\.(?:log|ldb)$/.test(name) &&
          NodeFS.readFileSync(NodePath.join(levelDb, name)).includes("stardust-migration-smoke"),
      )
        ? true
        : undefined,
    );
    const isolated = await launch(launchEnv);
    try {
      const page = await mainWindow(isolated);
      NodeAssert.equal(await isolated.evaluate(({ app }) => app.getPath("userData")), newProfile);
      await verifySeededThread(page);
      NodeAssert.equal(
        await page.evaluate(() => localStorage.getItem("stardust-migration-smoke")),
        "legacy",
      );
      NodeAssert.match(
        NodeFS.readFileSync(NodePath.join(newProfile, migrationMarker), "utf8").trim(),
        /^(copied|copied-with-local-storage-fallback)$/,
      );
      NodeAssert.equal(
        NodeFS.readFileSync(NodePath.join(newHome, "userdata", migrationMarker), "utf8"),
        "copied\n",
      );
      NodeAssert.equal(NodeFS.existsSync(NodePath.join(oldProfile, migrationMarker)), false);
      NodeAssert.equal(legacy.process().exitCode, null);
      NodeAssert.equal(legacyWindow.isClosed(), false);
      await isolated.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize());
      await NodeUtil.promisify(NodeChildProcess.execFile)(executablePath, ["--no-sandbox"], {
        env: launchEnv,
        timeout: 20_000,
        windowsHide: true,
      });
      await waitUntil("original Stardust window restored", async () =>
        (await isolated.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isMinimized(),
        )) === false
          ? true
          : undefined,
      );
      console.log(
        "Windows isolation smoke passed: legacy lock holder and Stardust both open; legacy browser data and server threads copied.",
      );
    } catch (error) {
      await recordFailure("stardust", isolated);
      throw error;
    } finally {
      await close(isolated);
    }
  } catch (error) {
    await recordFailure("legacy", legacy);
    throw error;
  } finally {
    await close(legacy);
  }
}

try {
  const smokeExecutable = await preparePlaywrightCopy(scratch);
  NodeFS.mkdirSync(NodePath.join(workspace, "src"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(workspace, "src/math.ts"), "export const sum = 1 + 1;\n");
  if (windows) await verifyWindowsProfileIsolation(smokeExecutable);
  for (const theme of ["light", "dark"]) {
    if (windows && values.native) {
      NodeChildProcess.execFileSync("pwsh.exe", [
        "-NoProfile",
        "-File",
        NodePath.join(import.meta.dirname, "windows-shell.ps1"),
        "-Action",
        "theme",
        "-Theme",
        theme,
      ]);
    }
    await withApp(smokeExecutable, theme, false, async (_app, page) => {
      await page
        .getByRole("heading", { name: /Welcome to Stardust|欢迎使用星尘/ })
        .waitFor({ timeout: 60_000 });
      await capture(page, `first-launch-${theme}`);
    });
    await withApp(smokeExecutable, theme, true, async (app, page) => {
      if (page.url().endsWith("#/welcome")) {
        await page.getByRole("button", { name: /^(Get started|Start|开始)$/ }).click();
      }
      const firstThread = page.locator("li[data-thread-item]", { hasText: "Release launch check" });
      const composer = page.getByTestId("composer-editor");
      const modelPicker = page.locator("[data-chat-provider-model-picker='true']");
      await page.locator("[data-stardust-hero-mark]").waitFor({ timeout: 60_000 });
      await composer.waitFor({ timeout: 60_000 });
      await modelPicker
        .locator('[data-model-chip-middot="true"]')
        .filter({ hasText: /^Showcase$/ })
        .waitFor({ timeout: 60_000 });
      await capture(page, `home-${theme}`);
      if (windows)
        NodeAssert.equal(
          await page.evaluate(() => document.documentElement.classList.contains("wco")),
          true,
        );
      try {
        await nativeScreenshot(app, `caption-corners-${theme}`);
      } catch (error) {
        console.warn(`Native caption screenshot (${theme}):`, error);
      }
      if (!(await firstThread.first().isVisible())) {
        await page
          .getByText(/^(待归类|Uncategorized)$/)
          .first()
          .click();
      }
      const secondThread = page.locator("li[data-thread-item]", { hasText: "Second thread" });
      await secondThread.first().click({ timeout: 20_000 });
      await modelPicker.click();
      await page.locator('[data-composer-permission-option="approval-required"]').click();
      await page.keyboard.press("Escape");
      await composer.fill("Show a tool approval");
      await composer.press("Enter");
      const pending = page.locator('[data-inbox-thread="launch-check-other"]');
      await pending.waitFor({ timeout: 30_000 });

      await firstThread.first().click({ timeout: 20_000 });
      await page.getByText("The release opens and shows this thread.").waitFor({ timeout: 60_000 });
      await composer.fill("Give me a short tour");
      await composer.press("Enter");
      const stop = page.getByRole("button", { name: /Stop generation|停止生成/ });
      await stop.waitFor({ timeout: 60_000 });
      await page
        .getByText("The project has a single math module", { exact: false })
        .waitFor({ timeout: 60_000 });
      const edited = page.locator('[data-v2-item-type="file_change"] [aria-expanded]').last();
      if (!(await edited.isVisible())) {
        const group = page.locator('[data-tool-group-toggle][aria-expanded="false"]').last();
        await group.click({ timeout: 15_000 });
      }
      await edited.waitFor({ timeout: 15_000 });
      if ((await edited.getAttribute("aria-expanded")) === "false") await edited.click();
      await page
        .getByRole("button", { name: /Open diff|打开差异|打开变更/ })
        .last()
        .click({ timeout: 15_000 });
      const diff = page.locator("[data-diff-file-key]").first();
      await diff.waitFor({ timeout: 15_000 });
      if ((await diff.getAttribute("aria-expanded")) === "false") await diff.click();
      await page.waitForFunction(
        () => document.querySelector("[data-diff-file-key][aria-expanded=true]") !== null,
      );
      await stop.waitFor({ timeout: 5_000 });
      await capture(page, `running-thread-${theme}`);
      await pending.waitFor({ timeout: 5_000 });
      for (const title of [
        "Release launch check",
        "Second thread",
        "Verify installer",
        "Appearance review",
      ]) {
        await page
          .locator("li[data-thread-item]", { hasText: title })
          .first()
          .waitFor({ timeout: 10_000 });
      }
      await capture(page, `sidebar-${theme}`);
      await stop.click();
      await stop.waitFor({ state: "hidden", timeout: 60_000 });
      await modelPicker.click();
      await page.locator('[data-composer-permission-option="auto"]').click();
      await page.locator('[data-composer-permission-option="auto"][aria-checked="true"]').waitFor();
      await page.locator("[data-effort-slider]").first().waitFor({ timeout: 15_000 });
      await page.locator("[data-v9-ctx-pill]").waitFor({ timeout: 15_000 });
      await capture(page, `composer-${theme}`);
      await page.keyboard.press("Escape");
      await openRoute(page, "/settings/general");
      await page.locator("#notifications").waitFor({ timeout: 60_000 });
      await capture(page, `general-${theme}`);
      if (windows) {
        const storageLink = page.locator('[data-settings-section="/settings/storage"]');
        NodeAssert.equal(await storageLink.count(), 0);
        await openRoute(page, "/settings/storage");
        await page
          .getByRole("heading", {
            name: /^(Storage & cleanup is macOS-only for now|存储与清理目前仅支持 macOS)$/,
          })
          .waitFor({ timeout: 15_000 });
      }
      await openRoute(page, "/settings/keybindings");
      const shortcutLabel = page.getByText(windows ? /^(Ctrl|Control)$/ : /^⌘$/).first();
      await shortcutLabel.waitFor({ timeout: 15_000 });
      const shortcutText = await shortcutLabel.textContent();
      await capture(page, `keybindings-${theme}`);
      await openRoute(page, "/settings/appearance");
      await page.locator("#appearance-interface").waitFor({ timeout: 60_000 });
      await capture(page, `appearance-${theme}`);
      await openRoute(page, "/settings/about");
      await page.locator("#about").waitFor({ timeout: 60_000 });
      await page.route(
        "https://api.github.com/repos/zds-xiaoxin/stardust/releases/latest",
        (route) => route.fulfill({ json: fixtureRelease }),
      );
      if (windows) {
        await page.evaluate(() => window.desktopBridge?.setUpdateAutoInstall?.(false));
      }
      await page.getByRole("button", { name: /Check for Updates|检查更新/ }).click();
      const state = await waitUntil<DesktopUpdateState>(
        "new fixture release is available",
        async () => {
          const current = await page.evaluate(() => window.desktopBridge?.getUpdateState());
          if (current?.availableVersion === newer) return current;
        },
      );
      NodeAssert.equal(state.currentVersion, version);
      await capture(page, `about-${theme}`);
      if (windows) {
        const system = NodeOS.release();
        const rendering = await page.evaluate(() => ({
          language: document.documentElement.lang,
          material: document.documentElement.dataset.windowMaterial,
          fontFamily: getComputedStyle(document.querySelector("#about h2")!).fontFamily,
        }));
        NodeAssert.match(rendering.fontFamily, /Microsoft YaHei/);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("DOM.enable");
        await cdp.send("CSS.enable");
        const { root } = await cdp.send("DOM.getDocument");
        const { nodeId } = await cdp.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector: "#about h2",
        });
        const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
        await cdp.detach();
        const download = await page.evaluate(() => window.desktopBridge?.downloadUpdate());
        windowsUpdateChecks.set(theme, download);
        windowsEvidence[theme] = {
          system,
          shortcutLabel: shortcutText,
          rendering,
          fonts,
          download,
        };
      }
    });
  }
  NodeAssert.ok(fixtureRequests > 0, "The desktop updater did not reach the loopback feed.");
  NodeFS.writeFileSync(NodePath.join(output, "geometry.json"), JSON.stringify(geometry, null, 2));
  NodeFS.writeFileSync(
    NodePath.join(output, "smoke.json"),
    JSON.stringify(
      {
        platform,
        version,
        fixtureRequests,
        releaseInspectorDisabled: true,
        playwrightCopy: true,
        ...(windows ? { windowsEvidence, legacyProfileIsolation: "passed" } : {}),
      },
      null,
      2,
    ),
  );
  for (const [theme, result] of windowsUpdateChecks) {
    NodeAssert.ok(result?.accepted && !result.completed, `${theme}: download must fail`);
    NodeAssert.equal(result.state.errorContext, "download");
    NodeAssert.equal(result.state.canRetry, true);
    NodeAssert.match(result.state.message ?? "", /checksum/i);
  }
  console.log(`Stardust ${version} smoke passed on ${platform}.`);
} finally {
  feed.close();
  NodeFS.rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
}
