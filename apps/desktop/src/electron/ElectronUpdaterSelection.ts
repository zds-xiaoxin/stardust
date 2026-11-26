// @effect-diagnostics nodeBuiltinImport:off -- Spawns the detached installer and runs macOS tools.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  STARDUST_LATEST_RELEASE_API,
  appBundleOfResourcesPath,
} from "../updates/stardustUpdate.ts";
import * as ElectronUpdater from "./ElectronUpdater.ts";
import * as StardustMacUpdater from "./StardustMacUpdater.ts";
import * as StardustWindowsUpdater from "./StardustWindowsUpdater.ts";
import { readStardustBuildInfo, type StardustUpdaterDeps } from "./StardustUpdater.ts";

function execFile(file: string, args: ReadonlyArray<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      file,
      [...args],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${file} failed: ${String(stderr || error.message).slice(0, 400)}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function spawnDetached(file: string, args: ReadonlyArray<string>): void {
  const child = NodeChildProcess.spawn(file, [...args], {
    detached: true,
    stdio: "ignore",
    env: {
      HOME: process.env.HOME ?? NodeOS.homedir(),
      USER: process.env.USER ?? "",
      LOGNAME: process.env.LOGNAME ?? "",
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    },
  });
  child.unref();
}

function spawnWindowsInstaller(script: string, logPath: string): Promise<void> {
  const powershell = NodePath.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  NodeFS.accessSync(powershell, NodeFS.constants.F_OK);
  const child = NodeChildProcess.spawn(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  return new Promise((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", (cause) => {
      void NodeFS.promises
        .appendFile(logPath, `Installer launch failed: ${cause.message}\n`)
        .catch(() => {});
      reject(cause);
    });
  });
}

function resolveWindowsLocalAppData(): string {
  return process.env.LOCALAPPDATA || NodePath.join(Electron.app.getPath("appData"), "..", "Local");
}

function fixtureUpdatePort(): number | null {
  const port = Number(process.env.STARDUST_UPDATE_FIXTURE_PORT);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const platform = yield* HostProcess.Platform;
    const arch = yield* HostProcess.Architecture;
    const resourcesPath = process.resourcesPath;
    const buildInfo = readStardustBuildInfo({
      platform,
      isPackaged: Electron.app.isPackaged,
      resourcesPath,
    });
    if (!buildInfo) return ElectronUpdater.layer;
    const fixturePort = fixtureUpdatePort();
    const shared: StardustUpdaterDeps = {
      buildInfo,
      // The network stack follows system proxy settings. Fixture requests stay on loopback.
      fetch: (url, init) => {
        if (fixturePort === null) {
          return Electron.net.fetch(url, { headers: init.headers, signal: init.signal });
        }
        const path =
          url === STARDUST_LATEST_RELEASE_API ? "/releases/latest" : new URL(url).pathname;
        return Electron.net.fetch(`http://127.0.0.1:${fixturePort}${path}`, {
          headers: init.headers,
          signal: init.signal,
          redirect: "error",
        });
      },
      quitApp: () => Electron.app.quit(),
      onWillQuit: (listener) => {
        Electron.app.on("will-quit", listener);
        return () => {
          Electron.app.removeListener("will-quit", listener);
        };
      },
    };
    const denyFixtureInstall = () => {
      throw new Error("Fixture builds cannot install updates.");
    };
    if (platform === "win32" && arch === "x64") {
      return StardustWindowsUpdater.layer({
        ...shared,
        currentExecutable: Electron.app.getPath("exe"),
        localAppData: resolveWindowsLocalAppData(),
        pid: process.pid,
        spawnInstaller: fixturePort === null ? spawnWindowsInstaller : denyFixtureInstall,
      });
    }
    const currentAppPath = platform === "darwin" ? appBundleOfResourcesPath(resourcesPath) : null;
    if (!currentAppPath) return ElectronUpdater.layer;
    return StardustMacUpdater.layer({
      ...shared,
      currentAppPath,
      homeDirectory: NodeOS.homedir(),
      pid: process.pid,
      execFile,
      spawnDetached: fixturePort === null ? spawnDetached : denyFixtureInstall,
    });
  }),
);
