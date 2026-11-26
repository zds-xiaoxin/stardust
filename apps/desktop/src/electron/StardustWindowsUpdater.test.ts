// @effect-diagnostics nodeBuiltinImport:off -- Uses a temporary downloaded installer.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import { makeStardustWindowsUpdater } from "./StardustWindowsUpdater.ts";
import { STARDUST_LATEST_RELEASE_API } from "../updates/stardustUpdate.ts";

const installerName = "T3-Stardust-v1.3.1-Windows-x64-Setup.exe";
const bytes = "fixture installer content";
const sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");

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
  }),
);

it.effect("rejects tampered bytes and leaves no Windows installer to run", () =>
  Effect.gen(function* () {
    const fixture = yield* withFixture(true);
    yield* fixture.service.checkForUpdates;
    expect(Exit.isFailure(yield* fixture.service.downloadUpdate.pipe(Effect.exit))).toBe(true);
    expect(
      NodeFS.existsSync(NodePath.join(fixture.localAppData, "Stardust", "updates", "1.3.1")),
    ).toBe(false);
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
