// @effect-diagnostics nodeBuiltinImport:off -- Hashes a downloaded file outside any Effect runtime.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

export const STARDUST_REPOSITORY = "zds-xiaoxin/stardust";
export const STARDUST_LATEST_RELEASE_API = `https://api.github.com/repos/${STARDUST_REPOSITORY}/releases/latest`;
export const STARDUST_BUILD_INFO_FILE = "stardust-build.json";

export type StardustUpdateErrorCode =
  | "network"
  | "rate-limited"
  | "invalid-release"
  | "no-asset"
  | "digest-mismatch"
  | "extract-failed"
  | "bundle-mismatch"
  | "version-mismatch"
  | "signature-invalid"
  | "not-writable"
  | "translocated"
  | "no-download"
  | "install-failed";

/**
 * User-facing English source text; the web UI translates these exact strings, so keep them free of
 * interpolated values. Details go to the cause and the update log.
 */
export const STARDUST_UPDATE_ERROR_MESSAGES: Readonly<Record<StardustUpdateErrorCode, string>> = {
  network: "Couldn’t reach GitHub to check for updates. Try again later.",
  "rate-limited": "GitHub is rate-limiting update checks. Try again later.",
  "invalid-release": "The latest release information is invalid.",
  "no-asset": "The latest release has no verifiable Mac Apple Silicon build.",
  "digest-mismatch": "The downloaded update failed its checksum. It was deleted; try again.",
  "extract-failed": "Couldn’t unpack the downloaded update. Try again.",
  "bundle-mismatch": "The downloaded update is not Stardust, so it was not installed.",
  "version-mismatch":
    "The downloaded update does not match the release version, so it was not installed.",
  "signature-invalid":
    "The downloaded update failed its code signature check, so it was not installed.",
  "not-writable":
    "Stardust can’t replace itself in this folder. Move it to Applications or a folder you can write to, then try again.",
  translocated:
    "macOS is running Stardust from a temporary location. Move it to the Applications folder, open it from there, then try again.",
  "no-download": "No downloaded update is ready to install.",
  "install-failed": "Couldn’t start the update installer. Your current version is unchanged.",
};

// Thrown inside the updater's promises and carried as ElectronUpdater error causes.
// @effect-diagnostics-next-line extendsNativeError:off
export class StardustUpdateError extends Error {
  readonly code: StardustUpdateErrorCode;
  readonly detail: string | undefined;
  constructor(
    code: StardustUpdateErrorCode,
    detail?: string,
    message = STARDUST_UPDATE_ERROR_MESSAGES[code],
  ) {
    super(message);
    this.name = "StardustUpdateError";
    this.code = code;
    this.detail = detail;
  }
}

/** The user-facing text of a Stardust update failure, found anywhere in a cause chain. */
export function stardustUpdateUserMessage(cause: unknown): string | null {
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (current instanceof StardustUpdateError) return current.message;
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return null;
}

export type StardustVersion = readonly [major: number, minor: number, patch: number];

/** Public Stardust versions are plain `major.minor.patch` (optionally `v`-prefixed), major >= 1. */
export function parseStardustVersion(value: string): StardustVersion | null {
  const match = /^v?([1-9]\d{0,5})\.(\d{1,5})\.(\d{1,5})$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when `left` is older, 0 when equal, positive when newer. Null when either is invalid. */
export function compareStardustVersions(left: string, right: string): number | null {
  const a = parseStardustVersion(left);
  const b = parseStardustVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Only a strictly newer public release is ever offered: never an equal or older one. */
export function isStardustUpgrade(candidate: string, running: string): boolean {
  const comparison = compareStardustVersions(candidate, running);
  return comparison !== null && comparison > 0;
}

export function normalizeStardustVersion(value: string): string | null {
  const parsed = parseStardustVersion(value);
  return parsed ? parsed.join(".") : null;
}

export interface StardustBuildInfo {
  /** The public release this build corresponds to, e.g. `1.2.1`. */
  readonly communityVersion: string;
  /** Local build label such as `C109-stardust`; public zips carry one too. */
  readonly customBuild: string | null;
}

/** Reads Contents/Resources/stardust-build.json; null unless it names a valid community version. */
export function parseStardustBuildInfo(raw: string): StardustBuildInfo | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const communityVersion =
    typeof record.communityVersion === "string"
      ? normalizeStardustVersion(record.communityVersion)
      : null;
  if (communityVersion === null) return null;
  return {
    communityVersion,
    customBuild:
      typeof record.customBuild === "string" && record.customBuild.trim().length > 0
        ? record.customBuild.trim()
        : null,
  };
}

export interface StardustRelease {
  readonly version: string;
  readonly tag: string;
  readonly releaseName: string | null;
  readonly releaseNotes: string | null;
  readonly releaseDate: string | null;
  readonly asset: {
    readonly name: string;
    readonly url: string;
    readonly size: number;
    readonly sha256: string;
  };
}

export type StardustUpdateTarget = "macOS-arm64" | "Windows-x64";

export function stardustAssetNames(
  target: StardustUpdateTarget,
  version: string,
): ReadonlyArray<string> {
  const suffix = target === "macOS-arm64" ? "macOS-arm64.zip" : "Windows-x64-Setup.exe";
  return [
    `Stardust-v${version}-${suffix}`,
    `Stardust-${version}-${suffix}`,
    `T3-Stardust-v${version}-${suffix}`,
    `T3-Stardust-${version}-${suffix}`,
  ];
}

function checkedReleaseTag(value: unknown): {
  release: Record<string, unknown>;
  version: string;
  tag: string;
} {
  if (!value || typeof value !== "object") throw new StardustUpdateError("invalid-release");
  const release = value as Record<string, unknown>;
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  const version = /^v/.test(tag) ? normalizeStardustVersion(tag) : null;
  if (version === null || release.draft !== false || release.prerelease !== false) {
    throw new StardustUpdateError("invalid-release", `unexpected release ${tag || "(no tag)"}`);
  }
  return { release, version, tag };
}

export function stardustReleaseVersion(value: unknown): string {
  return checkedReleaseTag(value).version;
}

/** Parses GitHub's `releases/latest` response. Only URLs this function builds are ever fetched. */
export function parseStardustRelease(
  value: unknown,
  target: StardustUpdateTarget = "macOS-arm64",
): StardustRelease {
  const { release, version, tag } = checkedReleaseTag(value);
  const names = stardustAssetNames(target, version);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  for (const name of names) {
    const asset = assets.find(
      (entry: unknown): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object" && (entry as Record<string, unknown>).name === name,
    );
    if (!asset) continue;
    const digest = typeof asset.digest === "string" ? asset.digest : "";
    const match = /^sha256:([a-f0-9]{64})$/.exec(digest);
    if (
      asset.state !== "uploaded" ||
      typeof asset.size !== "number" ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      !match
    ) {
      continue;
    }
    return {
      version,
      tag,
      releaseName: typeof release.name === "string" ? release.name : null,
      releaseNotes: typeof release.body === "string" ? release.body : null,
      releaseDate: typeof release.published_at === "string" ? release.published_at : null,
      asset: {
        name,
        url: `https://github.com/${STARDUST_REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
        size: asset.size,
        sha256: match[1]!,
      },
    };
  }
  throw new StardustUpdateError(
    "no-asset",
    `release ${tag} has no complete ${target} asset`,
    target === "Windows-x64"
      ? "The latest release has no verifiable Windows x64 build."
      : undefined,
  );
}

export function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = NodeCrypto.createHash("sha256");
    const stream = NodeFS.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Resolves when the file's sha256 equals `expectedHex`; otherwise rejects with digest-mismatch. */
export async function verifyFileSha256(filePath: string, expectedHex: string): Promise<void> {
  const expected = expectedHex.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new StardustUpdateError("digest-mismatch", "expected digest is not a sha256 hex string");
  }
  const actual = await sha256OfFile(filePath);
  if (actual !== expected) {
    throw new StardustUpdateError("digest-mismatch", `expected ${expected}, got ${actual}`);
  }
}

/** The `.app` bundle that contains `resourcesPath` (…/X.app/Contents/Resources), or null. */
export function appBundleOfResourcesPath(resourcesPath: string): string | null {
  const match = /^(.*\.app)\/Contents\/Resources\/?$/.exec(resourcesPath);
  return match?.[1] ?? null;
}

/** App Translocation runs quarantined apps from a read-only random path; replacing it is useless. */
export function isTranslocatedAppPath(appPath: string): boolean {
  return /\/AppTranslocation\//.test(appPath);
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface StardustInstallScriptOptions {
  /** The running app's process id; the script waits for it to exit. */
  readonly pid: number;
  /** The installed bundle to replace, e.g. /Applications/T3 Stardust.app. */
  readonly currentAppPath: string;
  /** The verified, extracted new bundle. */
  readonly newAppPath: string;
  /** ~/Library/Application Support/T3 Stardust/update-backup/<running version> */
  readonly backupDir: string;
  /** ~/Library/Logs/T3 Stardust/update.log */
  readonly logPath: string;
  /** The per-version download folder, removed after a successful install. */
  readonly cleanupDir: string | null;
  readonly fromVersion: string;
  readonly toVersion: string;
  /** False when installing on a normal quit: the user asked the app to stop, so it stays closed. */
  readonly relaunch: boolean;
  /** Seconds to wait for the app to quit before giving up without changing anything. */
  readonly waitTimeoutSeconds?: number;
  /** Overridable for tests; production uses /usr/bin/open. */
  readonly openCommand?: string;
  /** Overridable for unsigned test fixtures; production uses /usr/bin/codesign. */
  readonly codesignCommand?: string;
}

/**
 * A zsh script that swaps the app bundle after the app quits and rolls back on any failure.
 * Never uses sudo: when the folder is not writable the move fails and the old app is restored.
 */
export function buildStardustInstallScript(options: StardustInstallScriptOptions): string {
  const backupApp = `${options.backupDir}/${options.currentAppPath.split("/").pop() ?? "T3 Stardust.app"}`;
  const slash = options.currentAppPath.lastIndexOf("/");
  const directory = options.currentAppPath.slice(0, slash + 1);
  const currentName = options.currentAppPath.slice(slash + 1);
  const destination =
    currentName === "T3 Stardust.app" ? `${directory}Stardust.app` : options.currentAppPath;
  const stagedApp = `${directory}.${currentName}.update-previous`;
  const openCommand = options.openCommand ?? "/usr/bin/open";
  const codesignCommand = options.codesignCommand ?? "/usr/bin/codesign";
  const waitTimeout = Math.max(1, Math.floor(options.waitTimeoutSeconds ?? 600));
  return `#!/bin/zsh
# Stardust updater: ${options.fromVersion} -> ${options.toVersion}
set -u
umask 022
PID=${options.pid}
CURRENT=${shellQuote(options.currentAppPath)}
DESTINATION=${shellQuote(destination)}
NEW=${shellQuote(options.newAppPath)}
BACKUP_DIR=${shellQuote(options.backupDir)}
BACKUP=${shellQuote(backupApp)}
STAGED=${shellQuote(stagedApp)}
LOG=${shellQuote(options.logPath)}
CLEANUP=${shellQuote(options.cleanupDir ?? "")}
RELAUNCH=${options.relaunch ? 1 : 0}
OPEN=${shellQuote(openCommand)}
CODESIGN=${shellQuote(codesignCommand)}
installed=0
staged=0
FROM=${shellQuote(options.fromVersion)}
TO=${shellQuote(options.toVersion)}

mkdir -p "\${LOG:h}" 2>/dev/null
log() { print -r -- "$(/bin/date '+%Y-%m-%d %H:%M:%S') [$$] $*" >> "$LOG" 2>/dev/null; }

relaunch() {
  (( RELAUNCH )) || return 0
  env -i HOME="$HOME" USER="\${USER:-}" LOGNAME="\${LOGNAME:-}" TMPDIR="\${TMPDIR:-/tmp}" \\
    PATH=/usr/bin:/bin:/usr/sbin:/sbin "$OPEN" "$1" >> "$LOG" 2>&1
}

restore_previous() {
  if (( installed )); then
    /bin/rm -rf "$DESTINATION" >> "$LOG" 2>&1 || return 1
  fi
  if (( ! staged )) || { /bin/mv -n "$STAGED" "$CURRENT" >> "$LOG" 2>&1 && [[ ! -e "$STAGED" ]]; }; then
    log "rolled back to $FROM"
    return 0
  fi
  log "ROLLBACK FAILED: the previous app is kept at $STAGED"
  return 1
}

fail_before_swap() {
  log "update to $TO not applied: $1"
  relaunch "$CURRENT"
  exit 1
}

fail_after_swap() {
  log "update to $TO failed: $1; rolling back"
  if restore_previous; then
    relaunch "$CURRENT"
  else
    [[ ! -e "$STAGED" ]] || relaunch "$STAGED"
  fi
  exit 1
}

log "waiting for pid $PID to quit (update $FROM -> $TO)"
waited=0
while kill -0 "$PID" 2>/dev/null; do
  if (( waited >= ${waitTimeout * 10} )); then
    log "app did not quit within ${waitTimeout}s; update to $TO not applied"
    exit 1
  fi
  sleep 0.1
  (( waited += 1 ))
done

[[ -d "$NEW/Contents" ]] || fail_before_swap "new app is missing at $NEW"
[[ -d "$CURRENT/Contents" ]] || fail_before_swap "current app is missing at $CURRENT"
[[ ! -e "$STAGED" && ! -L "$STAGED" ]] || fail_before_swap "a previous app is already kept at $STAGED"
if [[ "$DESTINATION" != "$CURRENT" && ( -e "$DESTINATION" || -L "$DESTINATION" ) ]]; then
  fail_before_swap "destination already exists: $DESTINATION"
fi

verify_app() {
  [[ -f "$1/Contents/Info.plist" && -d "$1/Contents/MacOS" ]] &&
    "$CODESIGN" --verify --deep --strict "$1" >> "$LOG" 2>&1
}

stage_current() {
  /bin/mv -n "$CURRENT" "$STAGED" >> "$LOG" 2>&1 && [[ ! -e "$CURRENT" ]] || return 1
  staged=1
}

if [[ "$DESTINATION" == "$CURRENT" ]]; then
  verify_app "$NEW" || fail_before_swap "the new app failed verification"
  stage_current || fail_before_swap "cannot move $CURRENT aside (is the folder writable?)"
fi
/bin/mv -n "$NEW" "$DESTINATION" >> "$LOG" 2>&1 &&
  [[ ! -e "$NEW" ]] || fail_after_swap "cannot move the new app into place (is the folder writable?)"
installed=1
verify_app "$DESTINATION" || fail_after_swap "the installed app failed verification"
if (( ! staged )); then
  stage_current || fail_after_swap "cannot move $CURRENT aside (is the folder writable?)"
fi
log "installed $TO at $DESTINATION"

if (( RELAUNCH )); then
  relaunch "$DESTINATION" || fail_after_swap "could not open the new app"
  log "relaunched $TO"
fi

# Keep the previous version as the only backup.
if /bin/mkdir -p "$BACKUP_DIR" >> "$LOG" 2>&1; then
  if [[ ! -e "$BACKUP" && ! -L "$BACKUP" ]] &&
     /bin/mv -n "$STAGED" "$BACKUP" >> "$LOG" 2>&1 &&
     [[ ! -e "$STAGED" ]]; then
    log "backed up $FROM to $BACKUP"
    for old in "\${BACKUP_DIR:h}"/*(N/); do
      [[ "$old" == "$BACKUP_DIR" ]] || /bin/rm -rf "$old" >> "$LOG" 2>&1
    done
  else
    log "could not move the previous app to $BACKUP; kept at $STAGED"
  fi
else
  log "could not create $BACKUP_DIR; previous app kept at $STAGED"
fi
if [[ -n "$CLEANUP" && -d "$CLEANUP" ]]; then
  /bin/rm -rf "$CLEANUP" >> "$LOG" 2>&1
fi
log "update to $TO finished"
exit 0
`;
}

/** The v1.2.3 installer keeps its old path. Rename that bundle on the next regular quit. */
export function buildStardustLegacyRenameScript(options: {
  readonly pid: number;
  readonly currentAppPath: string;
  readonly logPath: string;
  readonly codesignCommand?: string;
}): string | null {
  const suffix = "/T3 Stardust.app";
  if (!options.currentAppPath.endsWith(suffix)) return null;
  const destination = options.currentAppPath.slice(0, -suffix.length) + "/Stardust.app";
  return `#!/bin/zsh
current=${shellQuote(options.currentAppPath)}
destination=${shellQuote(destination)}
log=${shellQuote(options.logPath)}
verify=${shellQuote(options.codesignCommand ?? "/usr/bin/codesign")}
/bin/mkdir -p "\${log:h}" || exit 1
for ((attempt = 0; attempt < 150; attempt++)); do
  kill -0 ${options.pid} 2>/dev/null || break
  /bin/sleep 0.2
done
kill -0 ${options.pid} 2>/dev/null && exit 1
[[ -d "$current/Contents" && ! -L "$current" && ! -e "$destination" && ! -L "$destination" ]] || exit 1
"$verify" --verify --deep --strict "$current" >> "$log" 2>&1 || exit 1
/bin/mv -n "$current" "$destination" >> "$log" 2>&1 && [[ ! -e "$current" ]] || exit 1
if ! "$verify" --verify --deep --strict "$destination" >> "$log" 2>&1; then
  /bin/mv -n "$destination" "$current" >> "$log" 2>&1
  exit 1
fi
print -r -- "Migrated Stardust 1.2.4 to $destination" >> "$log"
`;
}
