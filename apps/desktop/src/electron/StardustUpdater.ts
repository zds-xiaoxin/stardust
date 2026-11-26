// @effect-diagnostics nodeBuiltinImport:off -- Writes and hashes the downloaded release asset.
// @effect-diagnostics globalTimers:off -- Abort the network stream on idle.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  STARDUST_BUILD_INFO_FILE,
  STARDUST_LATEST_RELEASE_API,
  StardustUpdateError,
  isStardustUpgrade,
  parseStardustVersion,
  parseStardustBuildInfo,
  parseStardustRelease,
  stardustReleaseVersion,
  verifyFileSha256,
  type StardustBuildInfo,
  type StardustRelease,
  type StardustUpdateTarget,
} from "../updates/stardustUpdate.ts";
import {
  ElectronUpdater,
  ElectronUpdaterCheckForUpdatesError,
  ElectronUpdaterDownloadUpdateError,
  ElectronUpdaterQuitAndInstallError,
} from "./ElectronUpdater.ts";

const CHANNEL = "stardust";
const METADATA_TIMEOUT_MS = 20_000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

export interface StardustFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
}

export interface StardustUpdaterDeps {
  readonly buildInfo: StardustBuildInfo;
  readonly fetch: (
    url: string,
    init: { readonly headers: Record<string, string>; readonly signal: AbortSignal },
  ) => Promise<StardustFetchResponse>;
  readonly quitApp: () => void;
  readonly onWillQuit: (listener: () => void) => () => void;
  readonly now?: () => number;
}

interface PreparedUpdate {
  readonly release: StardustRelease;
  readonly payloadPath: string;
  readonly versionDir: string;
}

interface StardustInstaller {
  readonly target: StardustUpdateTarget;
  readonly cacheRoot: string;
  readonly beforeDownload: (
    release: StardustRelease,
  ) => Promise<(payloadPath: string, versionDir: string) => Promise<string>>;
  /** May settle once the installer process is confirmed running; the app quits only after that. */
  readonly start: (update: PreparedUpdate, relaunch: boolean) => void | Promise<void>;
  readonly onRegularQuit?: () => void;
}

export function describe(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).slice(0, 500);
}

async function downloadToFile(options: {
  readonly fetch: StardustUpdaterDeps["fetch"];
  readonly url: string;
  readonly filePath: string;
  readonly expectedSize: number;
  readonly onProgress: (progress: {
    percent: number;
    transferred: number;
    total: number;
    bytesPerSecond: number;
  }) => void;
  readonly now: () => number;
}): Promise<void> {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdleTimer = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  armIdleTimer();
  const output = NodeFS.createWriteStream(options.filePath);
  const closed = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });
  void closed.catch(() => {});
  try {
    let response: StardustFetchResponse;
    try {
      response = await options.fetch(options.url, {
        headers: { Accept: "application/octet-stream" },
        signal: controller.signal,
      });
    } catch (cause) {
      throw new StardustUpdateError("network", describe(cause));
    }
    if (!response.ok || !response.body) {
      throw new StardustUpdateError("network", `download HTTP ${response.status}`);
    }
    const total = options.expectedSize;
    const startedAt = options.now();
    let transferred = 0;
    const reader = response.body.getReader();
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (cause) {
        throw new StardustUpdateError("network", describe(cause));
      }
      if (chunk.done) break;
      armIdleTimer();
      transferred += chunk.value.byteLength;
      if (transferred > total) {
        throw new StardustUpdateError(
          "digest-mismatch",
          "download is larger than the release asset",
        );
      }
      await new Promise<void>((resolve, reject) =>
        output.write(chunk.value, (error) => (error ? reject(error) : resolve())),
      );
      const elapsedSeconds = Math.max(0.001, (options.now() - startedAt) / 1000);
      options.onProgress({
        percent: (transferred / total) * 100,
        transferred,
        total,
        bytesPerSecond: Math.round(transferred / elapsedSeconds),
      });
    }
    if (transferred !== total) {
      throw new StardustUpdateError(
        "network",
        `download ended at ${transferred} of ${total} bytes`,
      );
    }
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    controller.abort();
    output.end();
    await closed;
  }
}

/** @public */
export function makeStardustUpdater(deps: StardustUpdaterDeps, installer: StardustInstaller) {
  const events = new NodeEvents.EventEmitter();
  const now = deps.now ?? Date.now;
  const runningVersion = deps.buildInfo.communityVersion;
  let latest: StardustRelease | null = null;
  let prepared: PreparedUpdate | null = null;
  let autoInstallOnAppQuit = false;
  let installerStarted = false;

  const updateInfo = (release: StardustRelease) => ({
    version: release.version,
    releaseName: release.releaseName ?? release.tag,
    releaseNotes: release.releaseNotes ?? undefined,
    ...(release.releaseDate ? { releaseDate: release.releaseDate } : {}),
  });

  const check = async (): Promise<void> => {
    latest = null;
    events.emit("checking-for-update");
    let response: StardustFetchResponse;
    try {
      response = await deps.fetch(STARDUST_LATEST_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new StardustUpdateError("network", describe(cause));
    }
    if (!response.ok) {
      throw new StardustUpdateError(
        response.status === 403 || response.status === 429 ? "rate-limited" : "network",
        `releases/latest HTTP ${response.status}`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new StardustUpdateError("invalid-release", describe(cause));
    }
    const version = stardustReleaseVersion(body);
    if (!isStardustUpgrade(version, runningVersion)) {
      events.emit("update-not-available", { version });
      return;
    }
    const release = parseStardustRelease(body, installer.target);
    latest = release;
    events.emit("update-available", updateInfo(release));
  };

  const download = async (): Promise<void> => {
    const release = latest;
    if (!release)
      throw new StardustUpdateError("no-download", "no release found by the last check");
    if (
      prepared?.release.asset.sha256 === release.asset.sha256 &&
      prepared.release.asset.name === release.asset.name &&
      NodeFS.existsSync(prepared.payloadPath)
    ) {
      events.emit("update-downloaded", updateInfo(release));
      return;
    }
    const prepare = await installer.beforeDownload(release);
    prepared = null;
    await NodeFS.promises.mkdir(installer.cacheRoot, { recursive: true });
    const versionDir = NodePath.join(installer.cacheRoot, release.version);
    // Drop earlier downloads; only the release being fetched is kept.
    for (const entry of await NodeFS.promises.readdir(installer.cacheRoot, {
      withFileTypes: true,
    })) {
      if (
        entry.isDirectory() &&
        entry.name !== release.version &&
        parseStardustVersion(entry.name)
      ) {
        await NodeFS.promises.rm(NodePath.join(installer.cacheRoot, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }
    await NodeFS.promises.rm(versionDir, { recursive: true, force: true });
    await NodeFS.promises.mkdir(versionDir, { recursive: true });
    const assetPath = NodePath.join(versionDir, release.asset.name);
    const partialPath = `${assetPath}.part`;
    try {
      await downloadToFile({
        fetch: deps.fetch,
        url: release.asset.url,
        filePath: partialPath,
        expectedSize: release.asset.size,
        now,
        onProgress: (progress) => events.emit("download-progress", progress),
      });
      await verifyFileSha256(partialPath, release.asset.sha256);
      await NodeFS.promises.rename(partialPath, assetPath);
      const payloadPath = await prepare(assetPath, versionDir);
      prepared = { release, payloadPath, versionDir };
    } catch (error) {
      await NodeFS.promises.rm(versionDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    events.emit("update-downloaded", updateInfo(release));
  };

  let inFlightDownload: Promise<void> | undefined;
  const downloadOnce = () =>
    (inFlightDownload ??= download().finally(() => {
      inFlightDownload = undefined;
    }));

  const startInstaller = async (relaunch: boolean): Promise<void> => {
    const update = prepared;
    if (installerStarted) return;
    if (!update || !NodeFS.existsSync(update.payloadPath)) {
      throw new StardustUpdateError("no-download");
    }
    // Claimed before the launch settles so a quit in the meantime does not start a second one.
    installerStarted = true;
    try {
      await installer.start(update, relaunch);
    } catch (error) {
      installerStarted = false;
      throw error;
    }
  };

  const removeWillQuit = deps.onWillQuit(() => {
    if (installerStarted) return;
    try {
      if (autoInstallOnAppQuit && prepared) {
        // Nothing to report at quit; the download stays and the next session offers it again.
        startInstaller(false).catch(() => {});
        return;
      }
      if (!prepared) installer.onRegularQuit?.();
    } catch {
      // Nothing to report at quit; the download stays and the next session offers it again.
    }
  });

  const ignored = (name: string) =>
    Effect.fn(`StardustUpdater.${name}`)(function (_value: unknown) {
      return Effect.void;
    });
  const service = ElectronUpdater.of({
    setFeedURL: ignored("setFeedURL"),
    setAutoDownload: ignored("setAutoDownload"),
    setAutoInstallOnAppQuit: Effect.fn("StardustUpdater.setAutoInstallOnAppQuit")(function (value) {
      return Effect.sync(() => {
        autoInstallOnAppQuit = value;
      });
    }),
    setChannel: ignored("setChannel"),
    setAllowPrerelease: ignored("setAllowPrerelease"),
    // Downgrades are never allowed: an older build can lack migrations this one ran.
    allowDowngrade: Effect.succeed(false),
    setAllowDowngrade: ignored("setAllowDowngrade"),
    setFullChangelog: ignored("setFullChangelog"),
    setDisableDifferentialDownload: ignored("setDisableDifferentialDownload"),
    checkForUpdates: Effect.tryPromise({
      try: check,
      catch: (cause) => new ElectronUpdaterCheckForUpdatesError({ channel: CHANNEL, cause }),
    }),
    downloadUpdate: Effect.tryPromise({
      try: downloadOnce,
      catch: (cause) => new ElectronUpdaterDownloadUpdateError({ channel: CHANNEL, cause }),
    }),
    quitAndInstall: Effect.fn("StardustUpdater.quitAndInstall")(function ({
      isSilent,
      isForceRunAfter,
    }) {
      // Quit only once the installer is running, so a failed launch leaves the app open to report it.
      return Effect.tryPromise({
        try: async () => {
          await startInstaller(true);
          deps.quitApp();
        },
        catch: (cause) =>
          new ElectronUpdaterQuitAndInstallError({
            channel: CHANNEL,
            isSilent,
            isForceRunAfter,
            cause,
          }),
      });
    }),
    on: Effect.fn("StardustUpdater.on")(function (eventName, listener) {
      const untyped = listener as unknown as (...args: Array<unknown>) => void;
      return Effect.acquireRelease(
        Effect.sync(() => {
          events.on(eventName, untyped);
        }),
        () =>
          Effect.sync(() => {
            events.removeListener(eventName, untyped);
          }),
      ).pipe(Effect.asVoid);
    }),
    stardustFeed: {
      runningVersion,
      customBuild: deps.buildInfo.customBuild,
    },
  });
  return { service, dispose: removeWillQuit };
}

/** Only branded packaged builds opt in to the fork feed. */
export function readStardustBuildInfo(options: {
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
}): StardustBuildInfo | null {
  if (!options.isPackaged || (options.platform !== "darwin" && options.platform !== "win32"))
    return null;
  try {
    return parseStardustBuildInfo(
      NodeFS.readFileSync(NodePath.join(options.resourcesPath, STARDUST_BUILD_INFO_FILE), "utf8"),
    );
  } catch {
    return null;
  }
}

export const stardustUpdaterLayer = (make: () => ReturnType<typeof makeStardustUpdater>) =>
  Layer.effect(
    ElectronUpdater,
    Effect.acquireRelease(Effect.sync(make), ({ dispose }) => Effect.sync(dispose)).pipe(
      Effect.map(({ service }) => service),
    ),
  );
