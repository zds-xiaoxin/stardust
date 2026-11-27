import { createClerkBridge } from "@clerk/electron";
import * as NodeURL from "node:url";
import { storage } from "@clerk/electron/storage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { codexAuthDeliveryUrl, readCodexAuthHandoff } from "@t3tools/shared/codexAuthHandoff";
import { receiveCodexAuthCallback, CodexAuthCallbackError } from "./CodexAuthCallback.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import { providerAuthReturnUrl } from "@t3tools/shared/providerAuthReturnUrl";
import { promptLinkAppPath } from "@t3tools/shared/promptLinks";
import { readPairingAppLink } from "@t3tools/shared/remote";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { clerkFrontendApiHostnameFromPublishableKey } from "@t3tools/shared/relayAuth";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import { startupLockCopy } from "../i18n/catalog.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopUserData from "./DesktopUserData.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopWebLinks from "./DesktopWebLinks.ts";

declare const __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__: string | undefined;

export class DesktopClerkBridgeInitializationError extends Schema.TaggedError<DesktopClerkBridgeInitializationError>()(
  "DesktopClerkBridgeInitializationError",
  {
    stateDir: Schema.String,
    isDevelopment: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to initialize the desktop Clerk bridge for state directory "${this.stateDir}" (development: ${this.isDevelopment}).`;
  }
}

export class DesktopClerkBridgeCleanupError extends Schema.TaggedError<DesktopClerkBridgeCleanupError>()(
  "DesktopClerkBridgeCleanupError",
  {
    stateDir: Schema.String,
    isDevelopment: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to clean up the desktop Clerk bridge for state directory "${this.stateDir}" (development: ${this.isDevelopment}).`;
  }
}

export class DesktopClerk extends Context.Service<
  DesktopClerk,
  {
    readonly userDataPath: string;
    readonly configure: Effect.Effect<
      void,
      never,
      | ElectronApp.ElectronApp
      | ElectronWindow.ElectronWindow
      | DesktopWebLinks.DesktopWebLinks
      | Scope.Scope
    >;
  }
>()("@t3tools/desktop/app/DesktopClerk") {}

function resolveDesktopClerkFrontendApiHostname(
  publishableKey: string | undefined,
): string | undefined {
  const normalizedKey = publishableKey?.trim();
  if (!normalizedKey) return undefined;

  try {
    return clerkFrontendApiHostnameFromPublishableKey(normalizedKey);
  } catch {
    return undefined;
  }
}

export const desktopClerkFrontendApiHostname = resolveDesktopClerkFrontendApiHostname(
  typeof __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__ === "undefined"
    ? undefined
    : __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__,
);

function createDesktopClerkBridge(tokenDirectory: string, isDevelopment: boolean) {
  return createClerkBridge({
    storage: storage({ path: tokenDirectory }),
    manageSingleInstanceLock: false,
    passkeys: true,
    renderer: {
      scheme: ElectronProtocol.getDesktopScheme(isDevelopment),
      host: ElectronProtocol.DESKTOP_HOST,
    },
  });
}

const PROBE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronApp = yield* ElectronApp.ElectronApp;
  const shell = yield* ElectronShell.ElectronShell;
  const path = yield* Path.Path;

  const fs = yield* FileSystem.FileSystem;
  const dialog = yield* ElectronDialog.ElectronDialog;
  const random = yield* SecureRandom.SecureRandom;

  // Keep successful startup synchronous until the bridge registers its privileged scheme.
  const userDataPath = yield* DesktopUserData.resolveUserDataPath(environment);
  yield* DesktopUserData.profileMigration({ ...environment, userDataPath });
  yield* electronApp.setPath("userData", userDataPath);

  const probe = yield* random.uuidV4();
  const probePath = (id: string) => path.join(userDataPath, `stardust-instance-${id}`);
  const probeFile = probePath(probe);
  yield* fs.makeDirectory(userDataPath, { recursive: true }).pipe(Effect.ignore);
  const probeCreated = yield* fs.writeFileString(probeFile, "", { flag: "wx" }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
  const removeProbe = probeCreated
    ? fs.remove(probeFile, { force: true }).pipe(Effect.ignore)
    : Effect.void;
  const acquired = yield* electronApp
    .requestSingleInstanceLock({ stardustProbe: probe })
    .pipe(Effect.catchCause(() => Effect.succeed(false)));
  if (!acquired) {
    // Electron returns false for both a notified primary and an OS lock error.
    // Only an acknowledgement from the primary makes a silent exit appropriate.
    const acknowledged = fs.readFileString(probeFile).pipe(
      Effect.map((value) => value === "1"),
      Effect.orElseSucceed(() => false),
    );
    const reachedPrimary =
      probeCreated &&
      ((yield* acknowledged) ||
        (yield* Effect.sleep("3 seconds").pipe(Effect.andThen(acknowledged))));
    yield* removeProbe;
    if (!reachedPrimary) {
      yield* DesktopUserData.logEarlyStartup(
        environment.appDataDirectory,
        "Could not acquire the Stardust single-instance lock or reach its owner.",
      );
      if (environment.platform === "linux") yield* electronApp.whenReady.pipe(Effect.ignore);
      const copy = startupLockCopy(yield* electronApp.preferredSystemLanguages);
      yield* dialog.showErrorBox(copy.title, copy.message);
    }
    yield* electronApp.exit(reachedPrimary ? 0 : 1);
    return yield* Effect.never;
  }
  yield* removeProbe;
  // Chromium opens these caches at the first event-loop turn, before ready.
  yield* DesktopUserData.clearStaleGpuCaches({
    userDataPath,
    electronVersion: process.versions.electron,
  });

  const pendingSecondInstances: Array<readonly string[]> = [];
  let handleSecondInstance = (argv: readonly string[]) => {
    pendingSecondInstances.push(argv);
  };
  const runAck = Effect.runSyncWith(yield* Effect.context<never>());
  yield* electronApp.on(
    "second-instance",
    (
      _event: unknown,
      argv: readonly string[],
      _cwd: string,
      data?: { stardustProbe?: unknown },
    ) => {
      if (typeof data?.stardustProbe === "string" && PROBE_PATTERN.test(data.stardustProbe)) {
        // r+ only acknowledges an existing probe, including if its sender already timed out.
        runAck(
          fs
            .writeFileString(probePath(data.stardustProbe), "1", { flag: "r+" })
            .pipe(Effect.ignore),
        );
      }
      handleSecondInstance(argv);
    },
  );
  // macOS hands a launch link to open-url, which can fire before configure runs.
  const pendingOpenUrls: Array<string> = [];
  let handleOpenUrl = (url: string) => {
    pendingOpenUrls.push(url);
    return true;
  };
  yield* electronApp.on("open-url", (event: { preventDefault: () => void }, url: string) => {
    if (handleOpenUrl(url)) event.preventDefault();
  });

  if (Option.isSome(environment.legacyStateDir)) {
    yield* DesktopUserData.migrateOrStartFresh(environment.appDataDirectory, {
      kind: "server",
      source: environment.legacyStateDir.value,
      destination: environment.stateDir,
    });
  }

  yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        createDesktopClerkBridge(
          path.resolve(environment.stateDir, "clerk"),
          environment.isDevelopment,
        ),
      catch: (cause) =>
        new DesktopClerkBridgeInitializationError({
          stateDir: environment.stateDir,
          isDevelopment: environment.isDevelopment,
          cause,
        }),
    }),
    (bridge) =>
      Effect.try({
        try: () => bridge.cleanup(),
        catch: (cause) =>
          new DesktopClerkBridgeCleanupError({
            stateDir: environment.stateDir,
            isDevelopment: environment.isDevelopment,
            cause,
          }),
      }).pipe(Effect.orDie),
  );

  return DesktopClerk.of({
    userDataPath,
    configure: Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const webLinks = yield* DesktopWebLinks.DesktopWebLinks;
      const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
      const runPromise = Effect.runPromiseWith(context);

      const startProviderAuthHandoff = (value: string | undefined) => {
        if (!value) return false;
        const request = readCodexAuthHandoff(value, environment.isDevelopment);
        if (!request) return false;
        void runPromise(
          Effect.gen(function* () {
            yield* electronApp.whenReady;
            yield* Effect.tryPromise({
              try: (signal) =>
                receiveCodexAuthCallback(
                  request.authorizationUrl,
                  (url) => runPromise(shell.openExternal(url)),
                  (callbackUrl) => codexAuthDeliveryUrl(request, callbackUrl),
                  signal,
                ),
              catch: () =>
                new CodexAuthCallbackError({
                  detail:
                    "Could not receive hosted web ChatGPT sign-in. Retry or use the redirect URL in the web app.",
                }),
            });
          }).pipe(
            Effect.catch(() => Effect.logWarning("Could not complete ChatGPT desktop handoff.")),
          ),
        );
        return true;
      };
      const resumeProviderAuth = (value: string | undefined) => {
        const destination = providerAuthReturnUrl(value);
        const expectedOrigin = `${ElectronProtocol.getDesktopScheme(environment.isDevelopment)}://app`;
        if (!destination?.startsWith(`${expectedOrigin}/`)) return false;
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* electronWindow.currentMainOrFirst;
            if (Option.isNone(mainWindow)) return;
            yield* Effect.promise(() => mainWindow.value.loadURL(destination));
            yield* electronWindow.reveal(mainWindow.value);
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not return to provider setup", cause),
            ),
          ),
        );
        return true;
      };
      const openAppLink = (value: string | undefined) => {
        if (!value || (promptLinkAppPath(value) === null && readPairingAppLink(value) === null))
          return false;
        void runPromise(webLinks.receive(value));
        return true;
      };
      const args = yield* HostProcess.Arguments;
      args.some((value) => startProviderAuthHandoff(value) || openAppLink(value));
      const openWebLink = (url: string) => {
        if (!DesktopWebLinks.isWebLink(url)) return false;
        void runPromise(webLinks.receive(url));
        return true;
      };
      handleOpenUrl = (url) =>
        startProviderAuthHandoff(url) ||
        resumeProviderAuth(url) ||
        openWebLink(url) ||
        openAppLink(url);
      for (const url of pendingOpenUrls.splice(0)) handleOpenUrl(url);
      yield* electronApp.on("open-file", (event: { preventDefault: () => void }, path: string) => {
        if (!DesktopWebLinks.isWebPageFile(path)) return;
        event.preventDefault();
        void runPromise(webLinks.receive(NodeURL.pathToFileURL(path).href));
      });
      handleSecondInstance = (argv) => {
        if (
          argv?.some(
            (value) =>
              startProviderAuthHandoff(value) || resumeProviderAuth(value) || openAppLink(value),
          )
        )
          return;
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* electronWindow.currentMainOrFirst;
            if (Option.isSome(mainWindow)) yield* electronWindow.reveal(mainWindow.value);
          }),
        );
      };
      for (const argv of pendingSecondInstances.splice(0)) handleSecondInstance(argv);
    }).pipe(Effect.withSpan("desktop.clerk.configure")),
  });
});

export const layer = Layer.effect(DesktopClerk, make);
