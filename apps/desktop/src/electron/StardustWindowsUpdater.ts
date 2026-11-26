// @effect-diagnostics nodeBuiltinImport:off -- Starts the Windows installer after Electron exits.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { StardustUpdateError } from "../updates/stardustUpdate.ts";
import {
  describe,
  makeStardustUpdater,
  stardustUpdaterLayer,
  type StardustUpdaterDeps,
} from "./StardustUpdater.ts";

interface StardustWindowsUpdaterDeps extends StardustUpdaterDeps {
  readonly localAppData: string;
  readonly currentExecutable: string;
  readonly pid: number;
  /** Settles when the helper process is running, or rejects when it could not start. */
  readonly spawnInstaller: (script: string, logPath: string) => void | Promise<void>;
}

const psLiteral = (value: string): string => "'" + value.replaceAll("'", "''") + "'";

export function buildWindowsInstallScript(options: {
  readonly pid: number;
  readonly currentExecutable: string;
  readonly installer: string;
  readonly version: string;
  readonly sha256: string;
  readonly logPath: string;
  readonly relaunch: boolean;
}): string {
  return `
$ErrorActionPreference = 'Stop'
$exe = ${psLiteral(options.currentExecutable)}
$setup = ${psLiteral(options.installer)}
$log = ${psLiteral(options.logPath)}
$dir = Split-Path -Parent $exe
$backup = "$dir.update-previous"
$ready = $false
$copyStarted = $false
$relaunch = ${options.relaunch ? "$true" : "$false"}
function Write-UpdateLog([string] $text) {
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) $text" -Encoding UTF8
}
try {
  $running = Get-Process -Id ${options.pid} -ErrorAction SilentlyContinue
  if ($running -and -not $running.WaitForExit(60000)) {
    throw 'Stardust did not quit within 60 seconds.'
  }
  if ((Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash -ne ${psLiteral(options.sha256)}) {
    Remove-Item -LiteralPath $setup -Force
    throw 'The installer changed after downloading.'
  }
  if (Test-Path -LiteralPath $backup) { throw "Previous backup remains at $backup" }
  $copyStarted = $true
  Copy-Item -LiteralPath $dir -Destination $backup -Recurse -Force
  $ready = $true
  $result = Start-Process -FilePath $setup -ArgumentList '/S', '--updated', '/currentuser' -PassThru
  $result.WaitForExit()
  if ($result.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw "Setup failed with exit code $($result.ExitCode)."
  }
  $metadata = Get-Content -LiteralPath (Join-Path $dir 'resources/stardust-build.json') -Raw | ConvertFrom-Json
  if ($metadata.communityVersion -ne ${psLiteral(options.version)}) {
    throw 'Setup did not install the expected version.'
  }
  $ready = $false
  Write-UpdateLog 'Installation completed.'
  Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
} catch {
  Write-UpdateLog $_.Exception.Message
  if ($ready) {
    try {
      Remove-Item -LiteralPath $dir -Recurse -Force
      Move-Item -LiteralPath $backup -Destination $dir
      Write-UpdateLog 'Restored the previous installation files.'
    } catch {
      Write-UpdateLog "Rollback failed. The previous files are at $backup. $_"
      exit 1
    }
  } elseif ($copyStarted) {
    Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($relaunch -and (Test-Path -LiteralPath $exe -PathType Leaf) -and -not ($running -and -not $running.HasExited)) {
    Start-Process -FilePath $exe
  }
  exit 1
}
if ($relaunch) { Start-Process -FilePath $exe }
`;
}

export function makeStardustWindowsUpdater(deps: StardustWindowsUpdaterDeps) {
  const cacheRoot = NodePath.join(deps.localAppData, "Stardust", "updates");
  const logPath = NodePath.join(cacheRoot, "update.log");
  return makeStardustUpdater(deps, {
    target: "Windows-x64",
    cacheRoot,
    beforeDownload: async () => (payloadPath) => Promise.resolve(payloadPath),
    start: async (update, relaunch) => {
      try {
        NodeFS.accessSync(NodePath.dirname(deps.currentExecutable), NodeFS.constants.W_OK);
        const script = buildWindowsInstallScript({
          pid: deps.pid,
          currentExecutable: deps.currentExecutable,
          installer: update.payloadPath,
          version: update.release.version,
          sha256: update.release.asset.sha256,
          logPath,
          relaunch,
        });
        await deps.spawnInstaller(script, logPath);
      } catch (cause) {
        throw new StardustUpdateError("install-failed", describe(cause));
      }
    },
  });
}

export const layer = (deps: StardustWindowsUpdaterDeps) =>
  stardustUpdaterLayer(() => makeStardustWindowsUpdater(deps));
