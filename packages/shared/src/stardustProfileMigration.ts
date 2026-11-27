// @effect-diagnostics nodeBuiltinImport:off -- The Chromium profile must be published before Electron's pre-ready single-instance lock.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const MIGRATION_MARKER = "stardust-v127-migration";
export const LOCAL_STORAGE_FALLBACK = "copied-with-local-storage-fallback";

const TRANSIENT = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
  "ShaderCache",
  "Crashpad",
  "BrowserMetrics",
  "BrowserMetrics-spare.pma",
  "Dictionaries",
  "DIPS",
  "GrShaderCache",
  "LOCK",
  "lockfile",
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket",
  "DevToolsActivePort",
  MIGRATION_MARKER,
]);

const STATE_TRANSIENT = new Set([
  "anonymous-id",
  "environment-id",
  "environment-relay.json",
  "logs",
  "SingletonLock",
  MIGRATION_MARKER,
  "server-owner.sqlite",
  "server-runtime.json",
  "server-runtime.lock",
  "cli-command-path-entry",
  "ssh-launcher-id",
]);
const SQLITE_HEADER = Buffer.from("SQLite format 3\0");

// The packaged executable supports Node mode. One child takes the online
// backups without yielding the Electron main process before Clerk registers its scheme.
const BACKUP_SCRIPT = `
const { backup, DatabaseSync } = require("node:sqlite");
const { readFileSync } = require("node:fs");
(async () => {
  const { databases, bestEffort } = JSON.parse(readFileSync(0, "utf8"));
  const skipped = [];
  for (const [index, [source, destination]] of databases.entries()) {
    try {
      const database = new DatabaseSync(source, { readOnly: true });
      try {
        await backup(database, destination);
      } finally {
        database.close();
      }
    } catch (error) {
      if (!bestEffort) throw error;
      skipped.push(index);
    }
  }
  process.stdout.write(JSON.stringify(skipped));
})().catch(() => { process.exitCode = 1; });
`;

function isSQLite(path: string) {
  const fd = NodeFS.openSync(path, "r");
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    return (
      NodeFS.readSync(fd, header, 0, header.length, 0) === header.length &&
      header.equals(SQLITE_HEADER)
    );
  } finally {
    NodeFS.closeSync(fd);
  }
}

function isTransient(name: string) {
  return TRANSIENT.has(name) || /-(?:wal|shm|journal)$/.test(name);
}

function levelDbFingerprint(path: string) {
  return NodeFS.readdirSync(path)
    .filter((name) => !isTransient(name) && name !== "LOG" && name !== "LOG.old")
    .sort()
    .map((name) => {
      const { size, mtimeNs, ino } = NodeFS.lstatSync(NodePath.join(path, name), { bigint: true });
      return `${name}:${size}:${mtimeNs}:${ino}`;
    })
    .join("\n");
}

function copyDirectory(
  source: string,
  destination: string,
  sqlite: Array<[string, string]>,
  kind: ProfileMigration["kind"],
  isRoot: boolean,
  skipped: Set<string>,
) {
  const before = NodeFS.existsSync(NodePath.join(source, "CURRENT"))
    ? levelDbFingerprint(source)
    : null;
  for (const name of NodeFS.readdirSync(source)) {
    if (
      (kind === "chromium" && isTransient(name)) ||
      (before !== null && (name === "LOG" || name === "LOG.old")) ||
      (kind === "server" &&
        isRoot &&
        (STATE_TRANSIENT.has(name) || /\.sqlite3?-(?:wal|shm|journal)$/.test(name)))
    )
      continue;
    const from = NodePath.join(source, name);
    const to = NodePath.join(destination, name);
    const initialQueueLength = sqlite.length;
    try {
      const entry = NodeFS.lstatSync(from);
      if (entry.isDirectory()) {
        NodeFS.mkdirSync(to, { mode: 0o700 });
        copyDirectory(from, to, sqlite, kind, false, skipped);
      } else if (entry.isFile()) {
        const sqliteFile =
          kind === "chromium" ? isSQLite(from) : isRoot && /\.sqlite3?$/.test(name);
        if (sqliteFile) sqlite.push([from, to]);
        else NodeFS.copyFileSync(from, to, NodeFS.constants.COPYFILE_EXCL);
      }
    } catch (cause) {
      if (kind === "server" || !isRoot) throw cause;
      sqlite.length = initialQueueLength;
      NodeFS.rmSync(to, { recursive: true, force: true });
      skipped.add(name);
    }
  }
  if (before !== null && before !== levelDbFingerprint(source)) {
    throw new Error("A Chromium LevelDB changed during migration");
  }
}

function backupDatabases(databases: ReadonlyArray<[string, string]>, bestEffort: boolean) {
  if (databases.length === 0) return [];
  let skipped: readonly number[];
  try {
    const result = NodeChildProcess.execFileSync(process.execPath, ["-e", BACKUP_SCRIPT], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      input: JSON.stringify({ databases, bestEffort }),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
      windowsHide: true,
    });
    skipped = JSON.parse(result.toString("utf8")) as number[];
  } catch (cause) {
    if (!bestEffort) throw cause;
    skipped = databases.map((_entry, index) => index);
  }
  return skipped.map((index) => {
    const [, output] = databases[index]!;
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      NodeFS.rmSync(output + suffix, { force: true });
    }
    return output;
  });
}

export interface ProfileMigration {
  readonly destination: string;
  readonly source: string;
  readonly credentialFallbacks?: readonly string[];
  readonly kind: "chromium" | "server";
}

export function migrateProfile(input: ProfileMigration) {
  if (NodeFS.existsSync(input.destination)) return "existing";
  const hasSource = NodeFS.existsSync(input.source);
  const credentialFallback =
    hasSource && NodeFS.existsSync(NodePath.join(input.source, "Local State"))
      ? undefined
      : input.credentialFallbacks?.find((path) => NodeFS.existsSync(path));
  if (!hasSource && credentialFallback === undefined) return "fresh";

  const parent = NodePath.dirname(input.destination);
  NodeFS.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = NodeFS.mkdtempSync(NodePath.join(parent, ".stardust-migrate-"));
  try {
    const skipped = new Set<string>();
    if (hasSource) {
      const sqlite: Array<[string, string]> = [];
      copyDirectory(input.source, staging, sqlite, input.kind, true, skipped);
      for (const destination of backupDatabases(sqlite, input.kind === "chromium")) {
        const [root] = NodePath.relative(staging, destination).split(NodePath.sep);
        if (root) skipped.add(root);
      }
    }
    if (credentialFallback !== undefined) {
      NodeFS.copyFileSync(credentialFallback, NodePath.join(staging, "Local State"));
    }
    const marker = skipped.has("Local Storage") ? LOCAL_STORAGE_FALLBACK : "copied";
    NodeFS.writeFileSync(NodePath.join(staging, MIGRATION_MARKER), `${marker}\n`, { mode: 0o600 });
    // A competing launcher can only publish a non-empty destination, which rename never replaces.
    if (NodeFS.existsSync(input.destination)) return "existing";
    NodeFS.renameSync(staging, input.destination);
    return skipped.size > 0 ? "copied-partial" : "copied";
  } catch (error) {
    if (NodeFS.existsSync(input.destination)) return "existing";
    throw error;
  } finally {
    NodeFS.rmSync(staging, { recursive: true, force: true });
  }
}
