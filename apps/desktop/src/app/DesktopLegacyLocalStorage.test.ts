import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { LOCAL_STORAGE_FALLBACK, MIGRATION_MARKER } from "@t3tools/shared/stardustProfileMigration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLegacyLocalStorage from "./DesktopLegacyLocalStorage.ts";

const read = vi.hoisted(() => vi.fn());
vi.mock("./chromiumLocalStorage.ts", () => ({ readChromiumLocalStorage: read }));

it.effect("imports the V2 renderer storage once if its database could not be copied", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const oldStorage = path.join(root, "t3code-v2", "Local Storage", "leveldb");
    const newProfile = path.join(root, "stardust");
    yield* fs.makeDirectory(oldStorage, { recursive: true });
    yield* fs.makeDirectory(newProfile);
    yield* fs.writeFileString(path.join(newProfile, MIGRATION_MARKER), LOCAL_STORAGE_FALLBACK);
    yield* fs.writeFileString(path.join(newProfile, "v1-local-storage-imported"), "");
    read.mockReturnValue(Effect.succeed(new Map([["renderer-setting", "legacy"]])));

    yield* Effect.gen(function* () {
      const legacy = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage;
      yield* legacy.load(newProfile);
      const settings = yield* legacy.take;
      assert.equal(settings._tag === "Some" && settings.value["renderer-setting"], "legacy");
      assert.deepEqual(read.mock.calls, [[oldStorage, "t3code://app"]]);
      yield* legacy.complete;
      assert.isTrue(yield* fs.exists(path.join(newProfile, "v2-local-storage-imported")));

      yield* legacy.load(newProfile);
      assert.equal((yield* legacy.take)._tag, "None");
      assert.lengthOf(read.mock.calls, 1);
    }).pipe(
      Effect.provide(
        DesktopLegacyLocalStorage.layer.pipe(
          Layer.provide(
            Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
              appDataDirectory: root,
              isDevelopment: false,
            } as DesktopEnvironment.DesktopEnvironment["Service"]),
          ),
        ),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
