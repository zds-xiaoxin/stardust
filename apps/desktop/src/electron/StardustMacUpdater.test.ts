// @effect-diagnostics nodeBuiltinImport:off -- Builds fake app bundles in a temporary home folder.
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { it } from "@effect/vitest";
import { afterEach, describe, expect, vi } from "vite-plus/test";

import { StardustUpdateError } from "../updates/stardustUpdate.ts";
import {
  makeStardustMacUpdater,
  stardustUpdatePaths,
  type StardustFetchResponse,
  type StardustMacUpdaterDeps,
} from "./StardustMacUpdater.ts";

const BUNDLE_ID = "com.t3tools.t3code";
const temporaryDirs: string[] = [];
afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    NodeFS.chmodSync(dir, 0o755);
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

const payload = Buffer.from("pretend this is a 230 MB zip");
const payloadDigest = NodeCrypto.createHash("sha256").update(payload).digest("hex");

const release = (version: string, overrides: { digest?: string; size?: number } = {}) => ({
  tag_name: `v${version}`,
  name: `T3 Stardust v${version}`,
  draft: false,
  prerelease: false,
  published_at: "2026-11-23T00:00:00Z",
  body: `# v${version}\n\n1. **Faster** startup`,
  assets: [
    {
      name: `T3-Stardust-v${version}-macOS-arm64.zip`,
      state: "uploaded",
      size: overrides.size ?? payload.length,
      digest: `sha256:${overrides.digest ?? payloadDigest}`,
    },
  ],
});

const jsonResponse = (status: number, body: unknown): StardustFetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  body: null,
  json: async () => body,
});

const streamResponse = (bytes: Buffer): StardustFetchResponse => ({
  ok: true,
  status: 200,
  headers: { get: () => String(bytes.length) },
  body: new ReadableStream<Uint8Array>({
    start(controller) {
      const half = Math.floor(bytes.length / 2);
      controller.enqueue(new Uint8Array(bytes.subarray(0, half)));
      controller.enqueue(new Uint8Array(bytes.subarray(half)));
      controller.close();
    },
  }),
  json: async () => {
    throw new Error("not json");
  },
});

function makeBundle(appPath: string, bundleId: string, communityVersion: string) {
  NodeFS.mkdirSync(NodePath.join(appPath, "Contents", "MacOS"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(appPath, "Contents", "Resources"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(appPath, "Contents", "Info.plist"), bundleId);
  NodeFS.writeFileSync(
    NodePath.join(appPath, "Contents", "Resources", "stardust-build.json"),
    JSON.stringify({ communityVersion, customBuild: "C110-stardust" }),
  );
}

interface FakeOptions {
  readonly home?: string;
  readonly latest?: unknown;
  readonly latestStatus?: number;
  readonly download?: Buffer;
  readonly extracted?: { bundleId?: string; version?: string; apps?: number };
  readonly codesignFails?: boolean;
  readonly runningVersion?: string;
  readonly appFolderReadOnly?: boolean;
  readonly appPath?: (home: string) => string;
}

function makeFixture(options: FakeOptions = {}) {
  const home =
    options.home ?? NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-stardust-updater-"));
  if (!options.home) temporaryDirs.push(home);
  const currentAppPath =
    options.appPath?.(home) ?? NodePath.join(home, "Applications", "T3 Stardust.app");
  makeBundle(currentAppPath, BUNDLE_ID, options.runningVersion ?? "1.2.1");
  if (options.appFolderReadOnly) NodeFS.chmodSync(NodePath.dirname(currentAppPath), 0o555);

  const fetches: string[] = [];
  const execs: string[] = [];
  const spawned: Array<{ file: string; args: ReadonlyArray<string>; script: string }> = [];
  const events: Array<{ name: string; payload: unknown }> = [];
  let quitCount = 0;
  let willQuit: (() => void) | undefined;

  const deps: StardustMacUpdaterDeps = {
    buildInfo: {
      communityVersion: options.runningVersion ?? "1.2.1",
      customBuild: "C109-stardust",
    },
    currentAppPath,
    homeDirectory: home,
    pid: 4242,
    fetch: async (url) => {
      fetches.push(url);
      if (url.startsWith("https://api.github.com/")) {
        return jsonResponse(options.latestStatus ?? 200, options.latest ?? release("1.2.2"));
      }
      return streamResponse(options.download ?? payload);
    },
    execFile: async (file, args) => {
      execs.push([NodePath.basename(file), ...args.slice(0, 2)].join(" "));
      if (file === "/usr/bin/ditto") {
        const extractDir = args[3]!;
        const count = options.extracted?.apps ?? 1;
        for (let index = 0; index < count; index += 1) {
          makeBundle(
            NodePath.join(extractDir, index === 0 ? "T3 Stardust.app" : `Other ${index}.app`),
            options.extracted?.bundleId ?? BUNDLE_ID,
            options.extracted?.version ?? "1.2.2",
          );
        }
        return "";
      }
      if (file === "/usr/bin/plutil") {
        // The fake Info.plist holds just the bundle id.
        return NodeFS.readFileSync(args[5]!, "utf8");
      }
      if (file === "/usr/bin/codesign") {
        if (options.codesignFails) throw new Error("a sealed resource is missing or invalid");
        return "";
      }
      if (file === "/usr/bin/xattr") {
        if (args[0] === "-p") throw new Error("No such xattr: com.apple.quarantine");
        return "";
      }
      throw new Error(`unexpected tool ${file}`);
    },
    spawnDetached: (file, args) => {
      spawned.push({ file, args, script: NodeFS.readFileSync(args[0]!, "utf8") });
    },
    quitApp: () => {
      quitCount += 1;
    },
    onWillQuit: (listener) => {
      willQuit = listener;
      return () => {
        willQuit = undefined;
      };
    },
    now: () => 1_000,
  };
  const { service, dispose } = makeStardustMacUpdater(deps);
  const record = (name: string) =>
    service.on(name, (payload: unknown) => {
      events.push({ name, payload });
    });
  const subscribe = Effect.forEach(
    [
      "checking-for-update",
      "update-available",
      "update-not-available",
      "download-progress",
      "update-downloaded",
    ],
    record,
  );
  return {
    home,
    currentAppPath,
    service,
    dispose,
    fetches,
    execs,
    spawned,
    events,
    paths: stardustUpdatePaths(home),
    quitCount: () => quitCount,
    willQuit: () => willQuit?.(),
    run: <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.scoped(subscribe.pipe(Effect.andThen(effect))).pipe(Effect.exit),
  };
}

const causeOf = (exit: Exit.Exit<unknown, unknown>): StardustUpdateError | null => {
  if (!Exit.isFailure(exit)) return null;
  const error = (exit.cause as unknown as { reasons: Array<{ error?: { cause?: unknown } }> })
    .reasons[0]?.error?.cause;
  return error instanceof StardustUpdateError ? error : null;
};

describe("StardustMacUpdater check", () => {
  it.effect("offers a newer stable release from the fork", () =>
    Effect.gen(function* () {
      const fixture = makeFixture();
      const exit = yield* fixture.run(fixture.service.checkForUpdates);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fixture.fetches).toEqual([
        "https://api.github.com/repos/zds-xiaoxin/stardust/releases/latest",
      ]);
      expect(fixture.events.map((event) => event.name)).toEqual([
        "checking-for-update",
        "update-available",
      ]);
      expect(fixture.events[1]!.payload).toMatchObject({
        version: "1.2.2",
        releaseName: "T3 Stardust v1.2.2",
        releaseDate: "2026-11-23T00:00:00Z",
      });
      expect(fixture.service.stardustFeed).toEqual({
        runningVersion: "1.2.1",
        customBuild: "C109-stardust",
      });
      expect(yield* fixture.service.allowDowngrade).toBe(false);
    }),
  );

  it.effect("never offers an equal or older public release, also to a local custom build", () =>
    Effect.gen(function* () {
      for (const latest of ["1.2.1", "1.2.0", "1.1.9"]) {
        const fixture = makeFixture({ latest: release(latest), runningVersion: "1.2.1" });
        // A track switch may ask for downgrades; the Stardust updater ignores it.
        yield* fixture.service.setAllowDowngrade(true);
        yield* fixture.run(fixture.service.checkForUpdates);
        expect(fixture.events.map((event) => event.name)).toEqual([
          "checking-for-update",
          "update-not-available",
        ]);
        const download = yield* fixture.run(fixture.service.downloadUpdate);
        expect(causeOf(download)?.code).toBe("no-download");
      }
    }),
  );

  it.effect("reports rate limits and invalid releases with user-facing errors", () =>
    Effect.gen(function* () {
      const limited = makeFixture({ latestStatus: 403 });
      expect(causeOf(yield* limited.run(limited.service.checkForUpdates))?.code).toBe(
        "rate-limited",
      );
      const invalid = makeFixture({ latest: { ...release("1.2.2"), assets: [] } });
      expect(causeOf(yield* invalid.run(invalid.service.checkForUpdates))?.code).toBe("no-asset");
    }),
  );
});

describe("StardustMacUpdater download", () => {
  it.effect("downloads, verifies the digest, prepares the bundle and reports progress", () =>
    Effect.gen(function* () {
      const fixture = makeFixture();
      yield* fixture.run(fixture.service.checkForUpdates);
      const exit = yield* fixture.run(fixture.service.downloadUpdate);
      expect(Exit.isSuccess(exit)).toBe(true);

      expect(fixture.fetches[1]).toBe(
        "https://github.com/zds-xiaoxin/stardust/releases/download/v1.2.2/T3-Stardust-v1.2.2-macOS-arm64.zip",
      );
      const progress = fixture.events.filter((event) => event.name === "download-progress");
      expect(progress.length).toBe(2);
      expect(progress.at(-1)!.payload).toMatchObject({ percent: 100, total: payload.length });
      expect(fixture.events.at(-1)).toMatchObject({
        name: "update-downloaded",
        payload: { version: "1.2.2" },
      });
      expect(fixture.execs).toEqual([
        `plutil -extract CFBundleIdentifier`,
        `ditto -x -k`,
        `plutil -extract CFBundleIdentifier`,
        `codesign --verify --deep`,
        `xattr -dr com.apple.quarantine`,
        `xattr -p com.apple.quarantine`,
      ]);
      const [stage] = NodeFS.readdirSync(fixture.paths.cacheRoot);
      expect(stage).toMatch(/^mac-1\.2\.2-/);
      const versionDir = NodePath.join(fixture.paths.cacheRoot, stage!);
      expect(NodeFS.existsSync(NodePath.join(versionDir, "app", "T3 Stardust.app"))).toBe(true);
      // The verified zip is dropped once the bundle checks out.
      expect(NodeFS.readdirSync(versionDir)).toEqual(["app"]);
      expect(fixture.paths.cacheRoot).toBe(
        NodePath.join(fixture.home, "Library", "Caches", "T3 Stardust", "updates"),
      );
    }),
  );

  it.effect("prepares an update even when the legacy bundle cache cannot be removed", () =>
    Effect.gen(function* () {
      const fixture = makeFixture();
      const legacy = NodePath.join(fixture.paths.cacheRoot, "1.2.2");
      const resources = NodePath.join(legacy, "app", "Stardust.app", "Contents", "Resources");
      NodeFS.mkdirSync(resources, { recursive: true });
      const busy = NodePath.join(fixture.paths.cacheRoot, "1.0.0");
      const obsolete = NodePath.join(fixture.paths.cacheRoot, "mac-1.2.1-aB1234");
      const otherAttempt = NodePath.join(fixture.paths.cacheRoot, "mac-1.2.2-bC2345");
      for (const path of [busy, obsolete, otherAttempt]) NodeFS.mkdirSync(path);
      const remove = NodeFS.promises.rm.bind(NodeFS.promises);
      const cleanup = vi.spyOn(NodeFS.promises, "rm").mockImplementation((path, options) => {
        if (path === legacy || path === busy) {
          return Promise.reject(
            Object.assign(new Error("directory not empty"), { code: "ENOTEMPTY" }),
          );
        }
        return remove(path, options);
      });
      try {
        yield* fixture.service.checkForUpdates;
        const result = yield* fixture.run(fixture.service.downloadUpdate);
        expect(Exit.isSuccess(result)).toBe(true);
        expect(NodeFS.existsSync(resources)).toBe(true);
        expect(NodeFS.existsSync(otherAttempt)).toBe(true);
        expect(NodeFS.existsSync(obsolete)).toBe(false);
        expect(fixture.events.at(-1)?.name).toBe("update-downloaded");
      } finally {
        cleanup.mockRestore();
      }
    }),
  );

  it.effect("keeps both payloads and installer scripts when two instances share the cache", () =>
    Effect.gen(function* () {
      const first = makeFixture();
      const second = makeFixture({ home: first.home });
      const prepare = (fixture: typeof first) =>
        fixture.service.checkForUpdates.pipe(Effect.andThen(fixture.service.downloadUpdate));
      yield* Effect.all([prepare(first), prepare(second)], { concurrency: "unbounded" });
      for (const fixture of [first, second]) {
        yield* fixture.service.quitAndInstall({ isSilent: true, isForceRunAfter: true });
      }
      const scripts = [first, second].map((fixture) => fixture.spawned[0]!.args[0]!);
      expect(scripts[0]).not.toBe(scripts[1]);
      for (const script of scripts) {
        const stage = NodePath.dirname(script);
        expect(NodeFS.existsSync(NodePath.join(stage, "app", "T3 Stardust.app"))).toBe(true);
        expect(NodeFS.readFileSync(script, "utf8")).toContain(`CLEANUP='${stage}'`);
      }
    }),
  );

  it.effect("deletes a download whose sha256 does not match GitHub's digest", () =>
    Effect.gen(function* () {
      // Same size as the release asset, so only the digest differs.
      const tampered = makeFixture({ download: Buffer.alloc(payload.length, 7) });
      yield* tampered.run(tampered.service.checkForUpdates);
      expect(causeOf(yield* tampered.run(tampered.service.downloadUpdate))?.code).toBe(
        "digest-mismatch",
      );
      expect(NodeFS.readdirSync(tampered.paths.cacheRoot)).toEqual([]);
      expect(tampered.execs.some((entry) => entry.startsWith("ditto"))).toBe(false);

      const oversized = makeFixture({ download: Buffer.concat([payload, Buffer.from("extra")]) });
      yield* oversized.run(oversized.service.checkForUpdates);
      expect(causeOf(yield* oversized.run(oversized.service.downloadUpdate))?.code).toBe(
        "digest-mismatch",
      );
    }),
  );

  it.effect("refuses a bundle with another identifier, version or a broken signature", () =>
    Effect.gen(function* () {
      const cases: Array<[FakeOptions, string]> = [
        [{ extracted: { bundleId: "com.example.other" } }, "bundle-mismatch"],
        [{ extracted: { version: "1.2.1" } }, "version-mismatch"],
        [{ extracted: { apps: 2 } }, "extract-failed"],
        [{ codesignFails: true }, "signature-invalid"],
      ];
      for (const [options, code] of cases) {
        const fixture = makeFixture(options);
        yield* fixture.run(fixture.service.checkForUpdates);
        const exit = yield* fixture.run(fixture.service.downloadUpdate);
        expect(causeOf(exit)?.code).toBe(code);
        expect(NodeFS.readdirSync(fixture.paths.cacheRoot)).toEqual([]);
        expect(fixture.events.some((event) => event.name === "update-downloaded")).toBe(false);
      }
    }),
  );

  it.effect("refuses before downloading when the app cannot replace itself", () =>
    Effect.gen(function* () {
      const readOnly = makeFixture({ appFolderReadOnly: true });
      yield* readOnly.run(readOnly.service.checkForUpdates);
      expect(causeOf(yield* readOnly.run(readOnly.service.downloadUpdate))?.code).toBe(
        "not-writable",
      );
      expect(readOnly.fetches.length).toBe(1);
      NodeFS.chmodSync(NodePath.dirname(readOnly.currentAppPath), 0o755);

      const translocated = makeFixture({
        appPath: (home) => NodePath.join(home, "AppTranslocation", "4D3F", "d", "T3 Stardust.app"),
      });
      yield* translocated.run(translocated.service.checkForUpdates);
      expect(causeOf(yield* translocated.run(translocated.service.downloadUpdate))?.code).toBe(
        "translocated",
      );
    }),
  );
});

describe("StardustMacUpdater install", () => {
  it.effect("starts the detached installer with relaunch, then quits", () =>
    Effect.gen(function* () {
      const fixture = makeFixture();
      expect(
        causeOf(
          yield* fixture.run(
            fixture.service.quitAndInstall({ isSilent: true, isForceRunAfter: true }),
          ),
        )?.code,
      ).toBe("no-download");
      expect(fixture.quitCount()).toBe(0);

      yield* fixture.run(fixture.service.checkForUpdates);
      yield* fixture.run(fixture.service.downloadUpdate);
      const exit = yield* fixture.run(
        fixture.service.quitAndInstall({ isSilent: true, isForceRunAfter: true }),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fixture.quitCount()).toBe(1);
      expect(fixture.spawned.length).toBe(1);
      const [{ file, args, script }] = fixture.spawned as [(typeof fixture.spawned)[number]];
      expect(file).toBe("/bin/zsh");
      const [stage] = NodeFS.readdirSync(fixture.paths.cacheRoot);
      expect(args[0]).toBe(NodePath.join(fixture.paths.cacheRoot, stage!, "install.zsh"));
      expect(script).toContain("PID=4242");
      expect(script).toContain("RELAUNCH=1");
      expect(script).toContain(`CURRENT='${fixture.currentAppPath}'`);
      expect(script).toContain(
        `BACKUP_DIR='${NodePath.join(fixture.home, "Library", "Application Support", "T3 Stardust", "update-backup", "1.2.1")}'`,
      );
      expect(script).toContain(
        `LOG='${NodePath.join(fixture.home, "Library", "Logs", "T3 Stardust", "update.log")}'`,
      );
      // An install already started is not repeated by the quit it triggers.
      yield* fixture.service.setAutoInstallOnAppQuit(true);
      fixture.willQuit();
      expect(fixture.spawned.length).toBe(1);
    }),
  );

  it.effect("installs on a normal quit only when auto-install is on, without relaunching", () =>
    Effect.gen(function* () {
      const fixture = makeFixture();
      yield* fixture.run(fixture.service.checkForUpdates);
      yield* fixture.run(fixture.service.downloadUpdate);

      fixture.willQuit();
      expect(fixture.spawned).toEqual([]);

      yield* fixture.service.setAutoInstallOnAppQuit(true);
      fixture.willQuit();
      expect(fixture.spawned.length).toBe(1);
      expect(fixture.spawned[0]!.script).toContain("RELAUNCH=0");
      expect(fixture.quitCount()).toBe(0);

      fixture.dispose();
      fixture.willQuit();
      expect(fixture.spawned.length).toBe(1);
    }),
  );
});
