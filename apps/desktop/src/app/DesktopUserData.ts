import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Config from "effect/Config";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  MIGRATION_MARKER,
  migrateProfile,
  type ProfileMigration,
} from "@t3tools/shared/stardustProfileMigration";

export class DesktopUserDataInitializationError extends Schema.TaggedError<DesktopUserDataInitializationError>()(
  "DesktopUserDataInitializationError",
  {
    operation: Schema.Literals(["inspect", "read", "copy"]),
    resourcePath: Schema.String,
    category: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Could not initialize Electron user data during ${this.operation} at ${this.resourcePath} (${this.category}).`;
  }
}

export const resolveUserDataPath = Effect.fn("desktop.userData.resolveUserDataPath")(
  function* (input: { readonly appDataDirectory: string; readonly isDevelopment: boolean }) {
    const path = yield* Path.Path;
    const profileOverride = yield* Config.String("T3CODE_DESKTOP_USER_DATA_DIR").pipe(
      Config.option,
      Effect.mapError(
        (cause) =>
          new DesktopUserDataInitializationError({
            operation: "read",
            resourcePath: "T3CODE_DESKTOP_USER_DATA_DIR",
            category: "Configuration",
            cause,
          }),
      ),
    );
    if (Option.isSome(profileOverride) && profileOverride.value.trim().length > 0) {
      const directory = profileOverride.value.trim();
      if (!path.isAbsolute(directory))
        return yield* new DesktopUserDataInitializationError({
          operation: "inspect",
          resourcePath: directory,
          category: "InvalidPath",
          cause: new Error("Desktop profile override must be absolute"),
        });
      return path.normalize(directory);
    }
    return path.join(input.appDataDirectory, input.isDevelopment ? "stardust-dev" : "stardust");
  },
);

export const profileMigration = Effect.fn("desktop.userData.profileMigration")(function* (input: {
  readonly appDataDirectory: string;
  readonly userDataPath: string;
  readonly isDevelopment: boolean;
  readonly platform: NodeJS.Platform;
}) {
  const path = yield* Path.Path;
  const expected = path.join(
    input.appDataDirectory,
    input.isDevelopment ? "stardust-dev" : "stardust",
  );
  const override = yield* Config.option(Config.String("T3CODE_DESKTOP_USER_DATA_DIR")).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
  );
  if (input.userDataPath !== expected || Option.exists(override, (value) => value.trim() !== ""))
    return;
  const fs = yield* FileSystem.FileSystem;
  const oldDevelopment = path.join(input.appDataDirectory, "T3 Code (Dev)");
  const useOldDevelopment =
    input.isDevelopment &&
    (yield* fs.exists(oldDevelopment).pipe(Effect.orElseSucceed(() => false)));
  yield* migrateOrStartFresh(input.appDataDirectory, {
    kind: "chromium",
    destination: expected,
    source: useOldDevelopment
      ? oldDevelopment
      : path.join(input.appDataDirectory, input.isDevelopment ? "t3code-dev" : "t3code-v2"),
    ...(input.platform === "win32" && !input.isDevelopment
      ? {
          credentialFallbacks: ["T3 Code (Alpha)", "t3code"].map((name) =>
            path.join(input.appDataDirectory, name, "Local State"),
          ),
        }
      : {}),
  });
});

export const logEarlyStartup = Effect.fn("desktop.userData.logEarlyStartup")(function* (
  directory: string,
  message: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const now = yield* DateTime.now;
  yield* Effect.logWarning(message);
  yield* fs
    .writeFileString(
      path.join(directory, "stardust-startup.log"),
      `${DateTime.formatIso(now)} ${message}\n`,
      { flag: "a" },
    )
    .pipe(Effect.ignore);
});

export const migrateOrStartFresh = Effect.fn("desktop.userData.migrateOrStartFresh")(function* (
  logDirectory: string,
  input: ProfileMigration,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const attempt = Effect.gen(function* () {
    if (yield* fs.exists(input.destination)) return;
    for (const source of [input.source, ...(input.credentialFallbacks ?? [])]) {
      if (!(yield* fs.exists(source))) continue;
      const outcome = yield* Effect.try({
        try: () => migrateProfile(input),
        catch: (cause) =>
          new DesktopUserDataInitializationError({
            operation: "copy",
            resourcePath: input.destination,
            category: "ProfileMigration",
            cause,
          }),
      });
      if (outcome === "copied-partial") {
        yield* logEarlyStartup(
          logDirectory,
          "Copied the legacy Chromium profile. Some browser files were busy or unreadable and were skipped.",
        );
      }
      return;
    }
  });
  yield* attempt.pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        yield* logEarlyStartup(
          logDirectory,
          `Could not copy the legacy ${input.kind} profile. Starting with a fresh profile.`,
        );
        yield* fs.makeDirectory(input.destination, { recursive: true }).pipe(Effect.ignore);
        yield* fs
          .writeFileString(path.join(input.destination, MIGRATION_MARKER), "fresh-after-error\n", {
            flag: "wx",
          })
          .pipe(Effect.ignore);
      }),
    ),
  );
});

const GPU_CACHE_DIRECTORIES = [
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
];

// Keyed on Electron, not Chromium: Electron patches ship Chromium backports under the same Chrome version.
export const clearStaleGpuCaches = Effect.fn("desktop.userData.clearStaleGpuCaches")(
  function* (input: { readonly userDataPath: string; readonly electronVersion: string }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const markerPath = path.join(input.userDataPath, "gpu-cache-electron-version");
    const cachedVersion = yield* fs.readFileString(markerPath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.undefined,
      ),
    );
    if (cachedVersion?.trim() === input.electronVersion) return;
    for (const name of GPU_CACHE_DIRECTORIES) {
      yield* fs.remove(path.join(input.userDataPath, name), { recursive: true, force: true });
    }
    yield* fs.makeDirectory(input.userDataPath, { recursive: true });
    yield* fs.writeFileString(markerPath, input.electronVersion);
  },
  (effect, input) =>
    effect.pipe(
      Effect.catch((error) =>
        Effect.logWarning("could not clear stale GPU caches", {
          userDataPath: input.userDataPath,
          electronVersion: input.electronVersion,
          error: error.message,
        }),
      ),
    ),
);
