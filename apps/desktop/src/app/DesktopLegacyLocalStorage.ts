import { LOCAL_STORAGE_FALLBACK, MIGRATION_MARKER } from "@t3tools/shared/stardustProfileMigration";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import { readChromiumLocalStorage } from "./chromiumLocalStorage.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

/** Reads an older profile without opening it in Chromium, even while the old app runs. */
export class DesktopLegacyLocalStorage extends Context.Service<
  DesktopLegacyLocalStorage,
  {
    readonly load: (userDataPath: string) => Effect.Effect<void>;
    readonly take: Effect.Effect<Option.Option<Readonly<Record<string, string>>>>;
    readonly complete: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopLegacyLocalStorage") {}

const MARKER_FILE_NAME = "v1-local-storage-imported";
const V2_MARKER_FILE_NAME = "v2-local-storage-imported";
const V1_PROFILE_NAMES = ["T3 Code (Alpha)", "t3code"];

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const items = yield* Ref.make(Option.none<Readonly<Record<string, string>>>());
  const markerPath = yield* Ref.make(Option.none<string>());

  /** Newest file mtime in a directory; appending to a log leaves the directory's own mtime alone. */
  const newestFileMtime = Effect.fn("DesktopLegacyLocalStorage.newestFileMtime")(
    function* (directory: string) {
      let newest = 0;
      for (const name of yield* fs.readDirectory(directory)) {
        const info = yield* fs.stat(path.join(directory, name)).pipe(Effect.option);
        if (Option.isNone(info)) continue;
        const mtime = Option.match(info.value.mtime, {
          onNone: () => 0,
          onSome: (date) => date.getTime(),
        });
        newest = Math.max(newest, mtime);
      }
      return newest;
    },
    (effect, _directory) => effect.pipe(Effect.option),
  );

  const findV1LocalStorage = Effect.gen(function* () {
    let newest: { readonly directory: string; readonly mtime: number } | null = null;
    for (const name of V1_PROFILE_NAMES) {
      const directory = path.join(environment.appDataDirectory, name, "Local Storage", "leveldb");
      const mtime = yield* newestFileMtime(directory);
      if (Option.isNone(mtime)) continue;
      if (newest === null || mtime.value > newest.mtime) newest = { directory, mtime: mtime.value };
    }
    return newest?.directory ?? null;
  });

  const writeMarker = Effect.gen(function* () {
    const marker = yield* Ref.get(markerPath);
    if (Option.isNone(marker)) return;
    yield* fs
      .writeFileString(marker.value, "")
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not record the legacy Local Storage import", error),
        ),
      );
  });

  const load = Effect.fn("desktop.legacyLocalStorage.load")(function* (userDataPath: string) {
    if (environment.isDevelopment) return;
    const migration = yield* fs.readFileString(path.join(userDataPath, MIGRATION_MARKER)).pipe(
      Effect.map((value) => value.trim()),
      Effect.orElseSucceed(() => ""),
    );
    const needsV2 = migration === LOCAL_STORAGE_FALLBACK || migration === "fresh-after-error";
    const v2 = path.join(environment.appDataDirectory, "t3code-v2", "Local Storage", "leveldb");
    const useV2 = needsV2 && (yield* fs.exists(v2).pipe(Effect.orElseSucceed(() => false)));
    const marker = path.join(userDataPath, useV2 ? V2_MARKER_FILE_NAME : MARKER_FILE_NAME);
    if (yield* fs.exists(marker).pipe(Effect.orElseSucceed(() => true))) return;
    yield* Ref.set(markerPath, Option.some(marker));
    const directory = useV2 ? v2 : yield* findV1LocalStorage;
    if (directory === null) return yield* writeMarker;
    const origin = ElectronProtocol.getDesktopUrl(false).replace(/\/$/, "");
    const read = yield* readChromiumLocalStorage(directory, origin).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.tapError((error) =>
        Effect.logWarning("Could not read legacy Local Storage; will retry next launch", error),
      ),
      Effect.option,
    );
    if (Option.isNone(read)) return;
    yield* Effect.logInfo("Legacy Local Storage ready to import", {
      directory,
      keys: read.value.size,
    });
    yield* Ref.set(items, Option.some(Object.fromEntries(read.value)));
  });

  return DesktopLegacyLocalStorage.of({
    load,
    take: Ref.getAndSet(items, Option.none()),
    complete: writeMarker,
  });
});

export const layer = Layer.effect(DesktopLegacyLocalStorage, make);
