// @effect-diagnostics nodeBuiltinImport:off -- Uses a temporary downloaded installer.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";
import { makeStardustWindowsUpdater } from "./StardustWindowsUpdater.ts";
import { STARDUST_LATEST_RELEASE_API } from "../updates/stardustUpdate.ts";

const installerName = "T3-Stardust-v1.3.1-Windows-x64-Setup.exe";
const bytes = "fixture installer content";
const sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");

const updateCache = (localAppData: string) => NodePath.join(localAppData, "Stardust", "updates");

function withFixture(tamper: boolean, launch: () => Promise<void> = async () => {}) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const localAppData = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "stardust-windows-update-"),
      );
      const currentExecutable = NodePath.join(localAppData, "O'Brien", "星尘.exe");
      NodeFS.mkdirSync(NodePath.dirname(currentExecutable));
      const scripts: string[] = [];
      const requests: string[] = [];
      let quitCount = 0;
      const fixture = makeStardustWindowsUpdater({
        localAppData,
        currentExecutable,
        pid: 1234,
        buildInfo: { communityVersion: "1.3.0", customBuild: null },
        fetch: async (url) => {
          requests.push(url);
          return url === STARDUST_LATEST_RELEASE_API
            ? Response.json({
                tag_name: "v1.3.1",
                draft: false,
                prerelease: false,
                assets: [
                  {
                    name: installerName,
                    state: "uploaded",
                    size: bytes.length,
                    digest: `sha256:${sha256}`,
                  },
                ],
              })
            : new Response(tamper ? bytes.toUpperCase() : bytes);
        },
        quitApp: () => {
          quitCount += 1;
        },
        onWillQuit: () => () => {},
        spawnInstaller: (script) => {
          scripts.push(script);
          return launch();
        },
      });
      return { ...fixture, localAppData, scripts, requests, quitCount: () => quitCount };
    }),
    (fixture) =>
      Effect.sync(() => {
        fixture.dispose();
        NodeFS.rmSync(fixture.localAppData, { recursive: true, force: true });
      }),
  );
}

it.effect("verifies a legacy Windows asset before handing off to per-user setup", () =>
  Effect.gen(function* () {
    const fixture = yield* withFixture(false);
    yield* fixture.service.checkForUpdates;
    yield* fixture.service.downloadUpdate;
    expect(fixture.requests).toEqual([
      STARDUST_LATEST_RELEASE_API,
      `https://github.com/zds-xiaoxin/stardust/releases/download/v1.3.1/${installerName}`,
    ]);
    const installed = yield* fixture.service
      .quitAndInstall({ isSilent: true, isForceRunAfter: true })
      .pipe(Effect.exit);
    expect(Exit.isSuccess(installed)).toBe(true);
    expect(fixture.quitCount()).toBe(1);
    expect(fixture.scripts).toHaveLength(1);
    expect(fixture.scripts[0]).toContain("O''Brien");
    expect(fixture.scripts[0]).toContain("'/S', '--updated', '/currentuser'");
    expect(fixture.scripts[0]).toContain(sha256);
    const script = fixture.scripts[0]!;
    expect(script).toContain('$backup = "$previousBackup-$(New-Guid)"');
    expect(script).toContain("Remove-Item -LiteralPath $backup, $previousBackup");
    expect(script).toContain("$attempt -lt 30");
    expect(script).toContain("$_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)");
    expect(script).toContain("$dir.TrimEnd('\\') + '\\'");
    expect(script).toMatch(/Wait-InstallProcesses\s+\$ready = \$true\s+\$result = Start-Process/);
    expect(script).toMatch(/Wait-InstallProcesses\s+Invoke-WithFileRetries/);
    expect(script).toContain("-Raw -Encoding UTF8");
  }),
);

it.effect("rejects tampered bytes and leaves no Windows installer to run", () =>
  Effect.gen(function* () {
    const fixture = yield* withFixture(true);
    yield* fixture.service.checkForUpdates;
    expect(Exit.isFailure(yield* fixture.service.downloadUpdate.pipe(Effect.exit))).toBe(true);
    expect(NodeFS.readdirSync(updateCache(fixture.localAppData))).toEqual([]);
    expect(
      Exit.isFailure(
        yield* fixture.service
          .quitAndInstall({ isSilent: true, isForceRunAfter: true })
          .pipe(Effect.exit),
      ),
    ).toBe(true);
    expect(fixture.scripts).toEqual([]);
    expect(fixture.quitCount()).toBe(0);
  }),
);

it.effect("prepares setup even when an older cache and the target cache are locked", () =>
  Effect.gen(function* () {
    const fixture = yield* withFixture(false);
    const cache = updateCache(fixture.localAppData);
    const busy = NodePath.join(cache, "1.2.9");
    const obsolete = NodePath.join(cache, "win-1.3.0-aB1234");
    const legacy = NodePath.join(cache, "1.3.1");
    const anotherAttempt = NodePath.join(cache, "win-1.3.1-bC2345");
    for (const path of [busy, obsolete, legacy, anotherAttempt]) {
      NodeFS.mkdirSync(path, { recursive: true });
    }
    const remove = NodeFS.promises.rm.bind(NodeFS.promises);
    const cleanup = vi.spyOn(NodeFS.promises, "rm").mockImplementation((path, options) => {
      if (path === busy || path === legacy) {
        return Promise.reject(Object.assign(new Error("directory is locked"), { code: "EPERM" }));
      }
      return remove(path, options);
    });
    try {
      yield* fixture.service.checkForUpdates;
      yield* fixture.service.downloadUpdate;
      yield* fixture.service.quitAndInstall({ isSilent: true, isForceRunAfter: true });
      expect(NodeFS.existsSync(busy)).toBe(true);
      expect(NodeFS.existsSync(legacy)).toBe(true);
      expect(NodeFS.existsSync(anotherAttempt)).toBe(true);
      expect(NodeFS.existsSync(obsolete)).toBe(false);
      expect(fixture.scripts[0]).toMatch(/win-1\.3\.1-[A-Za-z0-9]{6}[/\\]T3-Stardust/);
      expect(fixture.quitCount()).toBe(1);
    } finally {
      cleanup.mockRestore();
    }
  }),
);

it.effect("stays open and can retry when the installer helper fails to start", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const fixture = yield* withFixture(false, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("spawn EACCES");
    });
    yield* fixture.service.checkForUpdates;
    yield* fixture.service.downloadUpdate;
    const install = fixture.service
      .quitAndInstall({ isSilent: true, isForceRunAfter: true })
      .pipe(Effect.exit);
    expect(Exit.isFailure(yield* install)).toBe(true);
    expect(fixture.quitCount()).toBe(0);
    expect(Exit.isSuccess(yield* install)).toBe(true);
    expect(fixture.quitCount()).toBe(1);
    expect(fixture.scripts).toHaveLength(2);
  }),
);

it.effect(
  "reports the cached installer on every download event and fetches it again when removed",
  () =>
    Effect.gen(function* () {
      const fixture = yield* withFixture(false);
      const downloadedFiles: Array<string | undefined> = [];
      yield* fixture.service.on("update-downloaded", (info: { downloadedFile?: string }) => {
        downloadedFiles.push(info.downloadedFile);
      });
      yield* fixture.service.checkForUpdates;
      yield* fixture.service.downloadUpdate;
      expect(downloadedFiles).toHaveLength(1);
      const installer = downloadedFiles[0]!;
      expect(NodePath.basename(installer)).toBe(installerName);
      expect(NodeFS.existsSync(installer)).toBe(true);

      yield* fixture.service.downloadUpdate;
      expect(fixture.requests).toHaveLength(2);
      expect(downloadedFiles).toEqual([installer, installer]);

      NodeFS.rmSync(installer);
      yield* fixture.service.downloadUpdate;
      expect(fixture.requests).toHaveLength(3);
      expect(downloadedFiles).toHaveLength(3);
      const replacement = downloadedFiles[2]!;
      expect(replacement).not.toBe(installer);
      expect(NodePath.basename(replacement)).toBe(installerName);
      expect(NodeFS.readFileSync(replacement, "utf8")).toBe(bytes);
    }),
);
