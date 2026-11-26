import { platformProfile } from "~/lib/PlatformProfile";
import { uiText } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { isElectron } from "../../env";
import { useCommunityUpdates } from "../../state/communityUpdates";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  COMMUNITY_BASE_TAG,
  COMMUNITY_RELEASES_URL,
  communityInstallPhase,
  communityOfferedVersion,
  communityUpdateActions,
  desktopCanSelfUpdate,
  runCommunityUpdateAndRestart,
} from "../../state/communityUpdates.logic";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { AboutVersionTitle } from "./AboutVersionTitle";
import { useUiText } from "../../i18n/useUiText";
import { openDesktopUpdateReleaseNotes } from "../desktopUpdate.toast";
const openPage = (url: string) => {
  void openDesktopUpdateReleaseNotes(window.desktopBridge, url);
};
const releaseNotesUrl = (version: string) =>
  `${COMMUNITY_RELEASES_URL}/tag/v${version.replace(/^v/, "")}`;
/** Desktop updater messages are fixed English sentences; translate the known ones. */
const updaterMessage = (message: string | null | undefined) =>
  message ? uiText(message) : uiText("The update couldn’t be installed. Try again later.");

let updateInFlight: Promise<void> | null = null;
/** "Update and restart": download, verify, quit, replace the app and relaunch in one click. */
export function updateAndRestart(): Promise<void> {
  const bridge = window.desktopBridge;
  if (!bridge) return Promise.resolve();
  if (updateInFlight) return updateInFlight;
  const failed = (message: string | null) => {
    toastManager.add({
      type: "error",
      title: uiText("Update not installed"),
      description: updaterMessage(message),
    });
  };
  updateInFlight = runCommunityUpdateAndRestart(bridge)
    .then((result) => {
      if (!result.ok) failed(result.message);
    })
    .catch(() => failed(null))
    .finally(() => {
      updateInFlight = null;
    });
  return updateInFlight;
}

export function CommunityUpdateCoordinator() {
  const autoInstall = useCommunityUpdates((s) => s.autoInstall);
  const mode = useCommunityUpdates((s) => s.mode);
  const release = useCommunityUpdates((s) => s.release);
  const status = useCommunityUpdates((s) => s.status);
  const desktopState = useDesktopUpdateState();
  const canSelfUpdate = desktopCanSelfUpdate(desktopState);
  const downloadedVersion = desktopState?.downloadedVersion ?? null;
  const announcedDownloadRef = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own the desktop update polling timers while this coordinator is mounted.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The desktop process keeps no copy of this preference, so push it at start and on every change.
  useEffect(() => {
    if (!isElectron) return;
    void window.desktopBridge?.setUpdateAutoInstall?.(autoInstall && mode === "standard");
  }, [autoInstall, mode]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize the imperative toast surface with a newly observed community release.
  useEffect(() => {
    if (!isElectron || status !== "available" || !release) return;
    const state = useCommunityUpdates.getState();
    if (state.notifiedTag === release.tag) return;
    state.markNotified(release.tag);
    const canInstall = communityUpdateActions(state.mode, canSelfUpdate).canInstall;
    toastManager.add({
      type: "info",
      title: uiText("Stardust {tag} is available", { tag: release.tag }),
      description: (
        <>
          <span>
            {state.mode === "custom"
              ? uiText("Source mode lets you review and merge changes in your fork.")
              : !canInstall
                ? uiText("Review the update and download it when you’re ready.")
                : state.autoInstall
                  ? uiText("It downloads in the background and installs the next time you quit.")
                  : uiText("Update now in one click, or review the notes first.")}
          </span>
          {canInstall && (
            <button
              type="button"
              className="ml-2 font-medium underline"
              onClick={() => {
                void updateAndRestart();
              }}
            >
              {uiText("Update and restart")}
            </button>
          )}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => openPage(state.mode === "custom" ? release.compareUrl : release.url)}
          >
            {canInstall ? uiText("View update notes") : uiText("View update")}
          </button>
        </>
      ),
    });
  }, [canSelfUpdate, release, status]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Announce each finished background download once through the imperative toast surface.
  useEffect(() => {
    if (!isElectron || !autoInstall || mode !== "standard" || !canSelfUpdate) return;
    if (!downloadedVersion || announcedDownloadRef.current === downloadedVersion) return;
    announcedDownloadRef.current = downloadedVersion;
    toastManager.add({
      type: "success",
      title: uiText("Stardust {version} is ready", { version: `v${downloadedVersion}` }),
      description: (
        <>
          <span>{uiText("It installs the next time you quit Stardust.")}</span>
          <button
            type="button"
            className="ml-2 font-medium underline"
            onClick={() => {
              void updateAndRestart();
            }}
          >
            {uiText("Restart now")}
          </button>
        </>
      ),
    });
  }, [autoInstall, canSelfUpdate, downloadedVersion, mode]);
  return null;
}

export function CommunityUpdatePreferences() {
  const state = useCommunityUpdates();
  const canSelfUpdate = desktopCanSelfUpdate(useDesktopUpdateState());
  return (
    <>
      <SettingsRow
        title={uiText("Community update mode")}
        description={
          canSelfUpdate
            ? uiText(
                "Standard mode updates in one click: download, verify, replace and restart. Source mode only links to source changes.",
              )
            : uiText(
                "Standard mode links to release downloads. Source mode links to source changes. Updating and restarting are manual in both modes.",
              )
        }
        control={
          <select
            aria-label={uiText("Community update mode")}
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={state.mode}
            onChange={(e) => state.setMode(e.target.value === "standard" ? "standard" : "custom")}
          >
            <option value="standard">
              {canSelfUpdate
                ? uiText("Standard · One-click update")
                : uiText("Standard · Confirm updates manually")}
            </option>
            <option value="custom">{uiText("Source mode · Notify only")}</option>
          </select>
        }
      />
      {canSelfUpdate && state.mode === "standard" && (
        <SettingsRow
          title={uiText("Download updates automatically and install on next launch")}
          description={uiText(
            "Downloads and verifies new versions in the background, then installs them when you quit. The next launch opens the new version.",
          )}
          control={
            <Switch
              aria-label={uiText("Download updates automatically and install on next launch")}
              checked={state.autoInstall}
              onCheckedChange={state.setAutoInstall}
            />
          }
        />
      )}
    </>
  );
}

export function CommunityUpdateSettings({ versionRowId }: { versionRowId?: string }) {
  const copy = useUiText();
  const state = useCommunityUpdates();
  const desktopState = useDesktopUpdateState();
  const canSelfUpdate = desktopCanSelfUpdate(desktopState);
  const actions = communityUpdateActions(state.mode, canSelfUpdate);
  const phase = communityInstallPhase(desktopState);
  const [installing, setInstalling] = useState(false);
  const currentVersion =
    canSelfUpdate && desktopState ? `v${desktopState.currentVersion}` : COMMUNITY_BASE_TAG;
  const offeredVersion = communityOfferedVersion(desktopState);
  const newVersion = offeredVersion ? `v${offeredVersion}` : (state.release?.tag ?? null);
  const updateFound = state.status === "available" || phase !== "none";
  const showInstall = actions.canInstall && updateFound;
  const desktopError =
    canSelfUpdate && desktopState?.status === "error" ? desktopState.message : null;
  const percent =
    typeof desktopState?.downloadPercent === "number"
      ? Math.floor(desktopState.downloadPercent)
      : 0;
  const statusText =
    phase === "downloading"
      ? copy("Downloading {version}… {percent}%", { version: newVersion, percent })
      : phase === "downloaded"
        ? copy("Current {current} · {version} is downloaded and ready to install", {
            current: currentVersion,
            version: newVersion,
          })
        : state.status === "checking" || desktopState?.status === "checking"
          ? copy("Checking…")
          : updateFound && newVersion
            ? actions.canInstall
              ? copy("Current {current} · New version {version}", {
                  current: currentVersion,
                  version: newVersion,
                })
              : copy("{version} available · {action}", {
                  version: newVersion,
                  action:
                    state.mode === "custom"
                      ? copy("Review and merge source changes as needed")
                      : copy("Review the notes, then download manually"),
                })
            : state.status === "current"
              ? copy("You have the latest community release.")
              : null;
  return (
    <>
      <SettingsRow
        id={versionRowId}
        title={
          <span className="inline-flex flex-wrap items-baseline gap-x-2">
            <AboutVersionTitle version={currentVersion} />
            <span aria-hidden="true">·</span>
            <Button
              size="xs"
              variant="link"
              className="px-0"
              disabled={state.status === "checking" || phase === "downloading" || installing}
              onClick={() => {
                void state.check(true);
                if (canSelfUpdate && !platformProfile.isWindowsDesktop)
                  void window.desktopBridge?.checkForUpdate();
              }}
            >
              {copy("Check for Updates")}
            </Button>
          </span>
        }
        description={
          statusText || state.error || desktopError ? (
            <span role="status">
              {state.error ?? (desktopError ? updaterMessage(desktopError) : statusText)}
            </span>
          ) : null
        }
      />
      {updateFound && (
        <div className="space-y-2 px-1 text-sm text-muted-foreground">
          <div className="flex flex-wrap gap-2">
            {showInstall && (
              <Button
                size="sm"
                disabled={phase === "downloading" || installing}
                onClick={() => {
                  setInstalling(true);
                  void updateAndRestart().finally(() => setInstalling(false));
                }}
              >
                {phase === "downloading"
                  ? copy("Downloading {percent}%", { percent })
                  : installing
                    ? copy("Preparing update…")
                    : copy("Update and restart")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                openPage(
                  offeredVersion
                    ? releaseNotesUrl(offeredVersion)
                    : (state.release?.url ?? COMMUNITY_RELEASES_URL),
                )
              }
            >
              {actions.canInstall ? copy("View update notes") : copy("View release notes")}
            </Button>
            {state.status === "available" &&
              state.release &&
              actions.canOpenDownloadPage &&
              !showInstall && (
                <Button size="sm" onClick={() => openPage(state.release!.url)}>
                  {copy("Open download page")}
                </Button>
              )}
            {state.status === "available" && state.release && actions.canViewSourceDiff && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openPage(state.release!.compareUrl)}
              >
                {copy("View source changes")}
              </Button>
            )}
          </div>
          {showInstall && (
            <p>
              {copy(
                "Updating keeps your conversations and settings. The previous version is kept as a backup and restored automatically if the update fails.",
              )}
            </p>
          )}
          {state.mode === "custom" && (
            <p>
              {copy(
                "Review and merge the changes in your fork before building. Replacing the app can overwrite your customizations.",
              )}
            </p>
          )}
        </div>
      )}
    </>
  );
}
