import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as NodeSqlite from "node:sqlite";
import { MIGRATION_MARKER } from "@t3tools/shared/stardustProfileMigration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import {
  clearStaleGpuCaches,
  migrateOrStartFresh,
  profileMigration,
  resolveUserDataPath,
} from "./DesktopUserData.ts";

const profile = (appDataDirectory: string, platform: NodeJS.Platform = "win32") => ({
  appDataDirectory,
  platform,
  isDevelopment: false,
});

it.effect.each(["win32", "darwin", "linux"] as const)(
  "isolates packaged and developer paths on %s",
  (platform) =>
    Effect.gen(function* () {
      const input = profile("/app-data", platform);
      const path = yield* Path.Path;
      assert.equal(yield* resolveUserDataPath(input), path.join("/app-data", "stardust"));
      assert.equal(
        yield* resolveUserDataPath({ ...input, isDevelopment: true }),
        path.join("/app-data", "stardust-dev"),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("uses the explicit override without importing anything into it", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const target = path.join(root, "stardust");
    const source = path.join(root, "t3code-v2");
    yield* fs.makeDirectory(source);
    yield* fs.writeFileString(path.join(source, "Preferences"), "{}");
    const provider = ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        T3CODE_DESKTOP_USER_DATA_DIR: `  ${target}  `,
      }),
    );
    const input = profile(root);
    const userDataPath = yield* resolveUserDataPath(input).pipe(Effect.provide(provider));
    yield* profileMigration({ ...input, userDataPath }).pipe(Effect.provide(provider));
    assert.equal(userDataPath, target);
    assert.isFalse(yield* fs.exists(target));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.each(["t3code", "T3 Code (Alpha)"])(
  "preserves Windows credential keys from %s for users skipping v1.2.6",
  (sourceName) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const source = path.join(directory, sourceName);
      const userDataPath = path.join(directory, "stardust");
      const state = '{"os_crypt":{"encrypted_key":"test-encrypted-key"}}';
      yield* fs.makeDirectory(path.join(source, "IndexedDB"), { recursive: true });
      yield* fs.writeFileString(path.join(source, "Local State"), state);
      yield* fs.writeFileString(path.join(source, "IndexedDB", "LOCK"), "V1 owns this database");
      yield* profileMigration({ ...profile(directory), userDataPath });
      assert.equal(yield* fs.readFileString(path.join(userDataPath, "Local State")), state);
      assert.equal(yield* fs.readFileString(path.join(source, "Local State")), state);
      assert.isFalse(yield* fs.exists(path.join(userDataPath, "IndexedDB")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("leaves fresh and existing profiles alone", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const source = path.join(root, "t3code-v2");
    const userDataPath = path.join(root, "stardust");
    const migrate = profileMigration({ ...profile(root), userDataPath });
    yield* migrate;
    assert.isFalse(yield* fs.exists(userDataPath));
    yield* fs.makeDirectory(userDataPath);
    yield* fs.makeDirectory(source);
    yield* fs.writeFileString(path.join(source, "Preferences"), "legacy");
    yield* fs.writeFileString(path.join(userDataPath, "Preferences"), "current");
    yield* migrate;
    assert.equal(yield* fs.readFileString(path.join(userDataPath, "Preferences")), "current");
    assert.isFalse(yield* fs.exists(path.join(userDataPath, MIGRATION_MARKER)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.each(["chromium", "server"] as const)(
  "copies committed WAL data from a running %s profile once",
  (kind) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const source = path.join(root, "legacy");
      const destination = path.join(root, "isolated");
      const dbName = kind === "server" ? "statev2.sqlite" : "Cookies";
      yield* fs.makeDirectory(source);
      const storageMarker = path.join(source, "v1-local-storage-imported");
      yield* fs.writeFileString(storageMarker, "imported");
      yield* fs.writeFileString(path.join(source, "SingletonLock"), "owned by the old app");
      yield* fs.writeFileString(path.join(source, "server-owner.sqlite"), "old server owner");
      if (kind === "chromium") yield* fs.remove(path.join(source, "server-owner.sqlite"));
      const oldDb = yield* Effect.acquireRelease(
        Effect.sync(() => new NodeSqlite.DatabaseSync(path.join(source, dbName))),
        (db) => Effect.sync(() => db.close()),
      );
      oldDb.exec(
        "PRAGMA journal_mode=WAL; CREATE TABLE records (message TEXT); INSERT INTO records VALUES ('live'); BEGIN; INSERT INTO records VALUES ('uncommitted');",
      );
      assert.isTrue(yield* fs.exists(path.join(source, `${dbName}-wal`)));
      const migrate = migrateOrStartFresh(root, { kind, source, destination });
      yield* migrate;
      assert.equal(yield* fs.readFileString(path.join(destination, MIGRATION_MARKER)), "copied\n");
      assert.equal(
        yield* fs.readFileString(path.join(destination, "v1-local-storage-imported")),
        "imported",
      );
      assert.isFalse(yield* fs.exists(path.join(destination, "SingletonLock")));
      assert.isFalse(yield* fs.exists(path.join(destination, "server-owner.sqlite")));
      assert.isFalse(yield* fs.exists(path.join(destination, `${dbName}-wal`)));
      oldDb.exec("COMMIT; INSERT INTO records VALUES ('after migration');");
      yield* migrate;
      const copied = new NodeSqlite.DatabaseSync(path.join(destination, dbName), {
        readOnly: true,
      });
      try {
        assert.deepEqual(
          copied
            .prepare("SELECT message FROM records")
            .all()
            .map(({ message }) => message),
          ["live"],
        );
      } finally {
        copied.close();
      }
      assert.isTrue(yield* fs.exists(path.join(source, "SingletonLock")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "keeps copied Chromium preferences when an unrelated browser database cannot be backed up",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const source = path.join(root, "legacy");
      const destination = path.join(root, "isolated");
      yield* fs.makeDirectory(source);
      yield* fs.writeFileString(path.join(source, "Cookies"), "SQLite format 3\0invalid data");
      yield* fs.writeFileString(path.join(source, "Preferences"), "legacy preferences");
      yield* fs.writeFileString(path.join(source, "Local State"), "legacy encryption state");
      yield* migrateOrStartFresh(root, { kind: "chromium", source, destination });
      assert.equal(
        yield* fs.readFileString(path.join(destination, "Preferences")),
        "legacy preferences",
      );
      assert.equal(
        yield* fs.readFileString(path.join(destination, "Local State")),
        "legacy encryption state",
      );
      assert.equal(yield* fs.readFileString(path.join(destination, MIGRATION_MARKER)), "copied\n");
      assert.isFalse(yield* fs.exists(path.join(destination, "Cookies")));
      assert.include(
        yield* fs.readFileString(path.join(root, "stardust-startup.log")),
        "busy or unreadable",
      );
      assert.isTrue(yield* fs.exists(path.join(source, "Cookies")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "writes a failure marker and discards a partial copy without modifying the legacy state",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const source = path.join(root, "legacy");
      const destination = path.join(root, "isolated");
      yield* fs.makeDirectory(source);
      yield* fs.writeFileString(path.join(source, "statev2.sqlite"), "invalid sqlite");
      yield* fs.writeFileString(path.join(source, "settings.json"), "{}");
      const migrate = migrateOrStartFresh(root, { kind: "server", source, destination });
      yield* migrate;
      assert.deepEqual(yield* fs.readDirectory(destination), [MIGRATION_MARKER]);
      assert.equal(
        yield* fs.readFileString(path.join(destination, MIGRATION_MARKER)),
        "fresh-after-error\n",
      );
      assert.equal(yield* fs.readFileString(path.join(source, "statev2.sqlite")), "invalid sqlite");
      assert.include(
        yield* fs.readFileString(path.join(root, "stardust-startup.log")),
        "Could not copy",
      );
      assert.isFalse(
        (yield* fs.readDirectory(root)).some((name) => name.startsWith(".stardust-migrate-")),
      );
      yield* migrate;
      assert.deepEqual(yield* fs.readDirectory(destination), [MIGRATION_MARKER]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const gpuCacheDirectories = [
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
];

it.effect.each([
  { profile: "written by Electron 44.10.0", marker: "44.10.0" },
  { profile: "with no recorded Electron version", marker: undefined },
])("clears GPU caches $profile once when Electron 44.10.1 starts", ({ marker }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const userDataPath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-gpu-cache-" });
    for (const name of gpuCacheDirectories) {
      yield* fs.makeDirectory(path.join(userDataPath, name), { recursive: true });
      yield* fs.writeFileString(path.join(userDataPath, name, "data_0"), "44.10.0 shaders");
    }
    yield* fs.makeDirectory(path.join(userDataPath, "Local Storage"), { recursive: true });
    yield* fs.writeFileString(path.join(userDataPath, "Local Storage", "LOCK"), "profile");
    yield* fs.writeFileString(path.join(userDataPath, "Local State"), "profile");
    if (marker !== undefined) {
      yield* fs.writeFileString(path.join(userDataPath, "gpu-cache-electron-version"), marker);
    }

    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });

    const survivingCaches: Array<string> = [];
    for (const name of gpuCacheDirectories) {
      if (yield* fs.exists(path.join(userDataPath, name))) survivingCaches.push(name);
    }
    assert.deepStrictEqual(survivingCaches, []);
    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "Local Storage", "LOCK")),
      "profile",
    );
    assert.equal(yield* fs.readFileString(path.join(userDataPath, "Local State")), "profile");

    yield* fs.makeDirectory(path.join(userDataPath, "GPUCache"));
    yield* fs.writeFileString(path.join(userDataPath, "GPUCache", "data_0"), "44.10.1 shaders");
    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });
    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "GPUCache", "data_0")),
      "44.10.1 shaders",
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps GPU caches built on the first launch of a fresh install", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const appData = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-fresh-" });
    const userDataPath = path.join(appData, "t3code-v2");

    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });
    yield* fs.makeDirectory(path.join(userDataPath, "GPUCache"));
    yield* fs.writeFileString(path.join(userDataPath, "GPUCache", "data_0"), "44.10.1 shaders");
    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });

    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "GPUCache", "data_0")),
      "44.10.1 shaders",
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("retries on the next launch when a GPU cache cannot be removed", () =>
  Effect.gen(function* () {
    const writes: Array<string> = [];
    const fileSystem = FileSystem.makeNoop({
      remove: (path) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "remove",
            pathOrDescriptor: path,
          }),
        ),
      writeFileString: (path) =>
        Effect.sync(() => {
          writes.push(path);
        }),
    });

    yield* clearStaleGpuCaches({ userDataPath: "/profile", electronVersion: "44.10.1" }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );

    assert.deepStrictEqual(writes, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);
