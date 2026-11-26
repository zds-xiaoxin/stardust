import { platformProfile } from "~/lib/PlatformProfile";
import { useSyncExternalStore } from "react";

import { isElectron } from "~/env";

import { isMacPlatform, isWindowsPlatform } from "./utils";

const WCO_CLASS_NAME = "wco";
const ELECTRON_CLASS_NAME = "electron";
const ELECTRON_WINDOWS_CLASS_NAME = "electron-windows";
// macOS has no overlay API; traffic lights stay inside this topbar at every zoom level.
const MACOS_TITLEBAR_HEIGHT = 52;

interface WindowControlsOverlayLike {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
  addEventListener(type: "geometrychange", listener: EventListener): void;
  removeEventListener(type: "geometrychange", listener: EventListener): void;
}

interface NavigatorWithWindowControlsOverlay extends Navigator {
  readonly windowControlsOverlay?: WindowControlsOverlayLike;
}

function getWindowControlsOverlay(): WindowControlsOverlayLike | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  return (navigator as NavigatorWithWindowControlsOverlay).windowControlsOverlay ?? null;
}

/** Height of the native caption strip drawn over the page, or 0 when the window has none. */
export function windowControlsOverlayHeight(): number {
  const overlay = getWindowControlsOverlay();
  return overlay?.visible ? overlay.getTitlebarAreaRect().height : 0;
}

export function onWindowControlsOverlayGeometryChange(listener: () => void): () => void {
  const overlay = getWindowControlsOverlay();
  if (!overlay) {
    return () => {};
  }

  overlay.addEventListener("geometrychange", listener);
  return () => {
    overlay.removeEventListener("geometrychange", listener);
  };
}

// Three 46px caption buttons in DesktopWindow.ts's 40px strip, assumed until Windows reports them.
const WINDOWS_CAPTION_FALLBACK = { left: 0, right: 138, bottom: 40 } as const;
const CAPTION_PROPERTIES = ["--wco-caption-left", "--wco-caption-right", "--wco-caption-height"];

export function syncDocumentWindowControlsOverlayClass(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const overlay = getWindowControlsOverlay();
  const root = document.documentElement;
  // Caption geometry as distances from the window edges, which survive a resize unchanged.
  let lastReported: { left: number; right: number; bottom: number } | null = null;
  const update = () => {
    const visible = overlay !== null && overlay.visible;
    root.classList.toggle(WCO_CLASS_NAME, visible);
    if (!overlay) return;
    // Measured caption geometry backs up the titlebar-area env() values, which Chromium can
    // leave unset or zero for a frame or after a zoom change; without it the controls slide
    // under the native minimize/maximize/close buttons. A hidden overlay (fullscreen) has none.
    let caption: { left: number; right: number; bottom: number } | null = null;
    if (visible) {
      const rect = overlay.getTitlebarAreaRect();
      if (rect.width > 0 && rect.height > 0) {
        lastReported = {
          left: Math.max(0, rect.left),
          right: Math.max(0, window.innerWidth - rect.right),
          bottom: rect.bottom,
        };
      }
      caption =
        lastReported ?? (platformProfile.id === "windows" ? WINDOWS_CAPTION_FALLBACK : null);
    }
    root.style.setProperty("--wco-caption-left", `${caption?.left ?? 0}px`);
    root.style.setProperty("--wco-caption-right", `${caption?.right ?? 0}px`);
    if (caption) root.style.setProperty("--wco-caption-height", `${caption.bottom}px`);
    else root.style.removeProperty("--wco-caption-height");
  };

  update();
  const stopGeometry = onWindowControlsOverlayGeometryChange(update);
  if (!overlay) return stopGeometry;
  window.addEventListener("resize", update);
  return () => {
    stopGeometry();
    window.removeEventListener("resize", update);
    root.classList.remove(WCO_CLASS_NAME);
    for (const property of CAPTION_PROPERTIES) root.style.removeProperty(property);
  };
}

function subscribeTitlebarArea(listener: () => void): () => void {
  const overlay = getWindowControlsOverlay();
  overlay?.addEventListener("geometrychange", listener);
  return () => overlay?.removeEventListener("geometrychange", listener);
}

function getNativeTitlebarHeight(): number {
  if (isElectron && isMacPlatform(platformProfile.platform)) return MACOS_TITLEBAR_HEIGHT;
  const overlay = getWindowControlsOverlay();
  return overlay?.visible ? overlay.getTitlebarAreaRect().bottom : 0;
}

export function useNativeTitlebarHeight(): number {
  return useSyncExternalStore(subscribeTitlebarArea, getNativeTitlebarHeight, () => 0);
}

function getElectronPlatformClassNames(
  platform: string,
):
  | readonly [typeof ELECTRON_CLASS_NAME]
  | readonly [typeof ELECTRON_CLASS_NAME, typeof ELECTRON_WINDOWS_CLASS_NAME] {
  return isWindowsPlatform(platform)
    ? [ELECTRON_CLASS_NAME, ELECTRON_WINDOWS_CLASS_NAME]
    : [ELECTRON_CLASS_NAME];
}

export function syncDocumentElectronPlatformClasses(platform: string): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const classNames = getElectronPlatformClassNames(platform);
  document.documentElement.classList.add(...classNames);
  return () => {
    document.documentElement.classList.remove(...classNames);
  };
}
