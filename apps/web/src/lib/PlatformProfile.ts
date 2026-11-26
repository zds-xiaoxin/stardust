import { isMacPlatform } from "@t3tools/shared/keybindings";
import { isElectron } from "~/env";

type PlatformId = "mac" | "windows" | "linux";

function currentPlatform(): string {
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

function platformId(platform: string): PlatformId {
  return isMacPlatform(platform) ? "mac" : /^win/i.test(platform) ? "windows" : "linux";
}

// Read on access rather than once at import, so code and tests that consult navigator.platform agree.
export const platformProfile = {
  get platform(): string {
    return currentPlatform();
  },
  get id(): PlatformId {
    return platformId(currentPlatform());
  },
  get modLabel(): "⌘" | "Ctrl" {
    return this.id === "mac" ? "⌘" : "Ctrl";
  },
  get isWindowsDesktop(): boolean {
    return isElectron && this.id === "windows";
  },
  get interfaceStyle(): "windows" | "default" {
    return this.isWindowsDesktop ? "windows" : "default";
  },
  get windowMaterial(): "mica" | "solid" {
    return this.isWindowsDesktop && window.stardustWindowMica ? "mica" : "solid";
  },
};

export function applyPlatformProfile(root: HTMLElement): void {
  root.dataset.platform = platformProfile.id;
  root.dataset.interfaceStyle = platformProfile.interfaceStyle;
  root.dataset.windowMaterial = platformProfile.windowMaterial;
}
