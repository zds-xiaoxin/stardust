import { page } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

import "../index.css";

import { syncDocumentWindowControlsOverlayClass } from "../lib/windowControlsOverlay";
import { PanelLayoutControls, WorkspaceTitlebarControls } from "./chat/PanelLayoutControls";

// Windows 11 draws three 46px caption buttons in the 40px strip DesktopWindow.ts reserves.
const CAPTION_WIDTH = 138;
const CAPTION_HEIGHT = 40;
const WIDTH_PROPERTY = "--workspace-titlebar-controls-width";

type Geometry = "right" | "left" | "empty" | "hidden";

/**
 * Windows desktop markers plus a stub caption overlay. Chromium leaves the titlebar-area env()
 * values unset here, so the layout rests entirely on the measured fallback.
 */
function windowsDesktop(themeId: string, initial: Geometry = "right") {
  const root = document.documentElement;
  const previous = { ...root.dataset };
  root.dataset.platform = "windows";
  root.dataset.interfaceStyle = "windows";
  root.dataset.themeId = themeId;
  const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  let geometry = initial;
  const listeners = new Set<EventListener>();
  const overlay = {
    get visible() {
      return geometry !== "hidden";
    },
    getTitlebarAreaRect: () => {
      const width = window.innerWidth - CAPTION_WIDTH;
      if (geometry === "left") return new DOMRect(CAPTION_WIDTH, 0, width, CAPTION_HEIGHT);
      if (geometry === "right") return new DOMRect(0, 0, width, CAPTION_HEIGHT);
      return new DOMRect(0, 0, 0, 0);
    },
    addEventListener: (_type: string, listener: EventListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: EventListener) => listeners.delete(listener),
  };
  Object.defineProperty(navigator, "windowControlsOverlay", { value: overlay, configurable: true });
  const stopSync = syncDocumentWindowControlsOverlayClass();
  return {
    setGeometry(next: Geometry) {
      geometry = next;
      for (const listener of listeners) listener(new Event("geometrychange"));
    },
    [Symbol.dispose]() {
      stopSync();
      platform.mockRestore();
      Reflect.deleteProperty(navigator, "windowControlsOverlay");
      for (const key of ["platform", "interfaceStyle", "themeId"] as const) {
        if (previous[key] === undefined) delete root.dataset[key];
        else root.dataset[key] = previous[key];
      }
    },
  };
}

function Titlebar(props: { readonly rightPanelOpen: boolean; readonly label?: string }) {
  return (
    <header
      className="drag-region flex items-center"
      style={{ height: "var(--workspace-topbar-height)" }}
    >
      <div data-quota-topbar="" className="flex items-center">
        <button type="button">62%</button>
      </div>
      <WorkspaceTitlebarControls
        showMaximizeControl
        rightPanelOpen={props.rightPanelOpen}
        animationsActive={false}
        maximized={false}
        onToggleMaximized={() => {}}
      >
        <PanelLayoutControls
          showThreadPanelControl={false}
          terminalAvailable
          terminalOpen={false}
          terminalShortcutLabel={null}
          threadPanelOpen={false}
          threadPanelPresentation="popover"
          threadPanelShortcutLabel={null}
          rightPanelAvailable
          rightPanelOpen={props.rightPanelOpen}
          rightPanelShortcutLabel={null}
          onToggleTerminal={() => {}}
          onToggleThreadPanel={() => {}}
          onToggleRightPanel={() => {}}
        />
        {props.label ? <span className="px-6">{props.label}</span> : null}
      </WorkspaceTitlebarControls>
    </header>
  );
}

const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
const centerY = (box: DOMRect) => box.top + box.height / 2;
const rootVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name);
const reserved = () =>
  Number.parseFloat(document.documentElement.style.getPropertyValue(WIDTH_PROPERTY));

/** Resolves a CSS length against the document, since custom properties read back unresolved. */
function resolvedWidth(value: string): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;top:0;left:0;height:1px;width:${value}`;
  document.body.append(probe);
  try {
    return probe.getBoundingClientRect().width;
  } finally {
    probe.remove();
  }
}

function expectClearOfRightCaption() {
  // 0.75rem clear of the minimize button.
  expect(rect("[data-workspace-titlebar-controls]").right).toBeLessThanOrEqual(
    window.innerWidth - CAPTION_WIDTH - 12,
  );
}

describe("Windows titlebar", () => {
  it.each(["stardust", "apple", "t3-chat"])(
    "keeps the app controls inside the 40px caption strip and clear of the caption buttons (%s)",
    async (themeId) => {
      await page.viewport(1280, 800);
      using _windows = windowsDesktop(themeId);
      await using _screen = await render(<Titlebar rightPanelOpen={false} />);

      expect(rect("header").height).toBe(CAPTION_HEIGHT);
      const strip = rect("[data-workspace-titlebar-controls]");
      expect(strip.top).toBe(0);
      expect(strip.height).toBe(CAPTION_HEIGHT);
      expectClearOfRightCaption();

      const toggles = rect("[data-panel-layout-controls]");
      expect(toggles.top).toBeGreaterThanOrEqual(0);
      expect(toggles.bottom).toBeLessThanOrEqual(CAPTION_HEIGHT);
      expect(Math.abs(centerY(toggles) - CAPTION_HEIGHT / 2)).toBeLessThanOrEqual(0.5);
      const quota = rect("[data-quota-topbar]");
      expect(Math.abs(centerY(quota) - centerY(toggles))).toBeLessThanOrEqual(0.5);
    },
  );

  it("drops the floating sidebar inset that pushed the brand above the window", async () => {
    using _windows = windowsDesktop("stardust");
    expect(rootVar("--liquid-sidebar-inset").trim()).toBe("0px");
  });

  it("keeps a safe reservation while the overlay reports no geometry, then follows it", async () => {
    await page.viewport(1040, 700);
    using windows = windowsDesktop("stardust", "empty");
    await using _screen = await render(<Titlebar rightPanelOpen={false} />);
    // No report yet: the Windows default caption width applies.
    expectClearOfRightCaption();
    expect(rect("[data-workspace-titlebar-controls]").height).toBe(CAPTION_HEIGHT);

    windows.setGeometry("right");
    expectClearOfRightCaption();
    // A transient empty rect keeps the last real geometry instead of dropping to zero.
    windows.setGeometry("empty");
    expectClearOfRightCaption();

    // Fullscreen hides the caption; nothing is reserved for it then.
    windows.setGeometry("hidden");
    expect(document.documentElement.classList.contains("wco")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--wco-caption-right")).toBe("0px");
  });

  it("moves the left controls past a caption drawn on the left", async () => {
    await page.viewport(1280, 800);
    using _windows = windowsDesktop("stardust", "left");
    expect(rootVar("--workspace-controls-left").trim()).not.toBe("");
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:var(--workspace-controls-left);top:0;width:1px;height:1px";
    document.body.append(probe);
    try {
      expect(probe.getBoundingClientRect().left).toBeGreaterThanOrEqual(CAPTION_WIDTH + 12);
    } finally {
      probe.remove();
    }
  });

  it("reserves the controls' measured width, maximize toggle included", async () => {
    await page.viewport(1280, 800);
    using _windows = windowsDesktop("stardust");
    await using screen = await render(<Titlebar rightPanelOpen={false} />);
    const closed = reserved();
    expect(closed).toBe(Math.ceil(rect("[data-workspace-titlebar-controls]").width));

    await screen.rerender(<Titlebar rightPanelOpen />);
    await expect.poll(reserved).toBeGreaterThan(closed);
    expect(reserved()).toBe(Math.ceil(rect("[data-workspace-titlebar-controls]").width));
    // The header shield under the fixed controls covers all of them.
    expect(resolvedWidth("var(--workspace-titlebar-controls-shield)")).toBeGreaterThanOrEqual(
      reserved(),
    );
  });

  it("keeps the newer controls' width when an older instance unmounts", async () => {
    await page.viewport(1280, 800);
    using _windows = windowsDesktop("stardust");
    const older = await render(<Titlebar rightPanelOpen={false} />);
    await using _newer = await render(<Titlebar rightPanelOpen={false} label="wider" />);
    const newerWidth = reserved();
    await older.unmount();
    expect(reserved()).toBe(newerWidth);
  });
});

describe("macOS titlebar reservations", () => {
  it("keep the fixed 7rem header room without a caption overlay", async () => {
    await page.viewport(1280, 800);
    await using screen = await render(<Titlebar rightPanelOpen={false} />);
    await screen.rerender(<Titlebar rightPanelOpen />);
    for (const name of ["reserve", "shield"]) {
      expect(resolvedWidth(`var(--workspace-titlebar-controls-${name})`)).toBe(112);
    }
  });
});
