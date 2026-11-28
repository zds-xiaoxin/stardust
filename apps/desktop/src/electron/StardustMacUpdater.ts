// @effect-diagnostics nodeBuiltinImport:off -- Streams a large download and spawns a detached installer.
/**
 * The ElectronUpdater service for ad-hoc signed T3 Stardust builds on macOS. It emits the events
 * electron-updater does, so DesktopUpdates and the existing update UI drive it unchanged.
 *
 * @module StardustMacUpdater
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  STARDUST_BUILD_INFO_FILE,
  StardustUpdateError,
  buildStardustInstallScript,
  buildStardustLegacyRenameScript,
  isTranslocatedAppPath,
  normalizeStardustVersion,
  parseStardustBuildInfo,
} from "../updates/stardustUpdate.ts";
import {
  describe,
  makeStardustUpdater,
  stardustUpdaterLayer,
  type StardustUpdaterDeps,
} from "./StardustUpdater.ts";

export type { StardustFetchResponse } from "./StardustUpdater.ts";

export interface StardustMacUpdaterDeps extends StardustUpdaterDeps {
  readonly currentAppPath: string;
  readonly homeDirectory: string;
  readonly pid: number;
  readonly execFile: (file: string, args: ReadonlyArray<string>) => Promise<string>;
  readonly spawnDetached: (file: string, args: ReadonlyArray<string>) => void;
}

export interface StardustUpdatePaths {
  readonly cacheRoot: string;
  readonly backupRoot: string;
  readonly logPath: string;
}

export function stardustUpdatePaths(homeDirectory: string): StardustUpdatePaths {
  const library = NodePath.join(homeDirectory, "Library");
  return {
    cacheRoot: NodePath.join(library, "Caches", "T3 Stardust", "updates"),
    backupRoot: NodePath.join(library, "Application Support", "T3 Stardust", "update-backup"),
    logPath: NodePath.join(library, "Logs", "T3 Stardust", "update.log"),
  };
}

/** Fails unless the app can replace itself without elevated rights. */
export function assertReplaceableAppLocation(appPath: string): void {
  if (isTranslocatedAppPath(appPath)) throw new StardustUpdateError("translocated", appPath);
  try {
    NodeFS.accessSync(NodePath.dirname(appPath), NodeFS.constants.W_OK);
    NodeFS.accessSync(appPath, NodeFS.constants.W_OK);
  } catch (cause) {
    throw new StardustUpdateError(
      "not-writable",
      `${NodePath.dirname(appPath)}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

async function readBundleIdentifier(
  execFile: StardustMacUpdaterDeps["execFile"],
  appPath: string,
): Promise<string> {
  const output = await execFile("/usr/bin/plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    "-o",
    "-",
    NodePath.join(appPath, "Contents", "Info.plist"),
  ]);
  return output.trim();
}

async function readBundleCommunityVersion(
  execFile: StardustMacUpdaterDeps["execFile"],
  appPath: string,
): Promise<string | null> {
  try {
    const raw = await NodeFS.promises.readFile(
      NodePath.join(appPath, "Contents", "Resources", STARDUST_BUILD_INFO_FILE),
      "utf8",
    );
    const info = parseStardustBuildInfo(raw);
    if (info) return info.communityVersion;
  } catch {}
  try {
    const shortVersion = await execFile("/usr/bin/plutil", [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      "-o",
      "-",
      NodePath.join(appPath, "Contents", "Info.plist"),
    ]);
    return normalizeStardustVersion(shortVersion.trim());
  } catch {
    return null;
  }
}

/**
 * Extracts and checks a verified zip: one .app, the running app's bundle id, the release's
 * version, a valid code signature, and no quarantine flag. Returns the extracted bundle.
 */
export async function prepareStardustUpdate(options: {
  readonly zipPath: string;
  readonly extractDir: string;
  readonly expectedBundleId: string;
  readonly expectedVersion: string;
  readonly execFile: StardustMacUpdaterDeps["execFile"];
}): Promise<string> {
  const { execFile } = options;
  await NodeFS.promises.mkdir(options.extractDir);
  try {
    await execFile("/usr/bin/ditto", ["-x", "-k", options.zipPath, options.extractDir]);
  } catch (cause) {
    throw new StardustUpdateError("extract-failed", describe(cause));
  }
  const apps = (await NodeFS.promises.readdir(options.extractDir, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
  );
  if (apps.length !== 1) {
    throw new StardustUpdateError("extract-failed", `expected one .app, found ${apps.length}`);
  }
  const appPath = NodePath.join(options.extractDir, apps[0]!.name);

  let bundleId: string;
  try {
    bundleId = await readBundleIdentifier(execFile, appPath);
  } catch (cause) {
    throw new StardustUpdateError("bundle-mismatch", describe(cause));
  }
  if (bundleId !== options.expectedBundleId) {
    throw new StardustUpdateError(
      "bundle-mismatch",
      `expected ${options.expectedBundleId}, got ${bundleId}`,
    );
  }

  const version = await readBundleCommunityVersion(execFile, appPath);
  if (version !== options.expectedVersion) {
    throw new StardustUpdateError(
      "version-mismatch",
      `expected ${options.expectedVersion}, got ${version ?? "unknown"}`,
    );
  }

  try {
    await execFile("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  } catch (cause) {
    throw new StardustUpdateError("signature-invalid", describe(cause));
  }
  // xattr exits non-zero when nothing carried the flag; the check below is what matters.
  await execFile("/usr/bin/xattr", ["-dr", "com.apple.quarantine", appPath]).catch(() => "");
  const stillQuarantined = await execFile("/usr/bin/xattr", [
    "-p",
    "com.apple.quarantine",
    appPath,
  ]).then(
    () => true,
    () => false,
  );
  if (stillQuarantined) {
    throw new StardustUpdateError("extract-failed", "could not clear com.apple.quarantine");
  }
  return appPath;
}

export function makeStardustMacUpdater(deps: StardustMacUpdaterDeps) {
  const paths = stardustUpdatePaths(deps.homeDirectory);
  const runningVersion = deps.buildInfo.communityVersion;
  return makeStardustUpdater(deps, {
    target: "macOS-arm64",
    cacheRoot: paths.cacheRoot,
    beforeDownload: async (release) => {
      assertReplaceableAppLocation(deps.currentAppPath);
      const expectedBundleId = await readBundleIdentifier(deps.execFile, deps.currentAppPath);
      return async (zipPath, versionDir) => {
        const appPath = await prepareStardustUpdate({
          zipPath,
          extractDir: NodePath.join(versionDir, "app"),
          expectedBundleId,
          expectedVersion: release.version,
          execFile: deps.execFile,
        });
        await NodeFS.promises.rm(zipPath, { force: true });
        return appPath;
      };
    },
    start: (update, relaunch) => {
      assertReplaceableAppLocation(deps.currentAppPath);
      const script = buildStardustInstallScript({
        pid: deps.pid,
        currentAppPath: deps.currentAppPath,
        newAppPath: update.payloadPath,
        backupDir: NodePath.join(paths.backupRoot, runningVersion),
        logPath: paths.logPath,
        cleanupDir: update.versionDir,
        fromVersion: runningVersion,
        toVersion: update.release.version,
        relaunch,
      });
      const scriptPath = NodePath.join(update.versionDir, "install.zsh");
      try {
        NodeFS.mkdirSync(NodePath.dirname(paths.logPath), { recursive: true });
        NodeFS.writeFileSync(scriptPath, script, { mode: 0o700 });
        deps.spawnDetached("/bin/zsh", [scriptPath]);
      } catch (cause) {
        throw new StardustUpdateError("install-failed", describe(cause));
      }
    },
    onRegularQuit: () => {
      if (runningVersion !== "1.2.4") return;
      const rename = buildStardustLegacyRenameScript({
        pid: deps.pid,
        currentAppPath: deps.currentAppPath,
        logPath: paths.logPath,
      });
      if (!rename) return;
      assertReplaceableAppLocation(deps.currentAppPath);
      NodeFS.mkdirSync(NodePath.dirname(paths.logPath), { recursive: true });
      deps.spawnDetached("/bin/zsh", ["-c", rename]);
    },
  });
}

export const layer = (deps: StardustMacUpdaterDeps) =>
  stardustUpdaterLayer(() => makeStardustMacUpdater(deps));
