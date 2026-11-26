import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render, stubGlobal } from "../../test/render";

import "../index.css";

vi.mock(import("../env"), () => ({ isElectron: true }));

vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+b", command: "sidebar.toggle", when: "!terminalFocus" },
  ]);
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(keybindings) };
});
// The thread list needs live environments; the shortcut lives in the shell around it.
vi.mock(import("./Sidebar"), () => ({ default: (() => null) as never }));

vi.mock(import("./LegacySidebar"), () => ({ default: (() => null) as never }));

import { AppSidebarLayout } from "./AppSidebarLayout";
import { WorkspaceTitlebarControls } from "./chat/PanelLayoutControls";
import { SidebarInset } from "./ui/sidebar";

describe("sidebar toggle shortcut", () => {
  it("leaves the key to a focused terminal when its rule excludes terminalFocus", async () => {
    await page.viewport(1280, 800);
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(
      <AppSidebarLayout>
        <div data-terminal-owner="drawer">
          <textarea aria-label="Terminal input" />
        </div>
        <button type="button">Outside</button>
      </AppSidebarLayout>,
    );
    const wrapper = screen.container.querySelector('[data-slot="sidebar-wrapper"]')!;

    await userEvent.click(screen.getByRole("textbox", { name: "Terminal input" }));
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(wrapper.getAttribute("data-sidebar-state")).toBe("expanded");

    await userEvent.click(screen.getByRole("button", { name: "Outside" }));
    await userEvent.keyboard("{Control>}b{/Control}");
    await vi.waitFor(() => expect(wrapper.getAttribute("data-sidebar-state")).toBe("collapsed"));
  });
});

describe("native fullscreen layout", () => {
  it.each([
    { platform: "MacIntel", fullscreenTop: 32, controlsLeft: "90px" },
    { platform: "Win32", fullscreenTop: 0, controlsLeft: "calc(0px + 0.75rem)" },
  ])(
    "keeps the top controls clear on $platform",
    async ({ platform, fullscreenTop, controlsLeft }) => {
      await page.viewport(1280, 800);
      using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      let notifyFullscreen: ((fullscreen: boolean) => void) | undefined;
      using _bridge = stubGlobal("desktopBridge", {
        getWindowFullscreenState: () => false,
        onMenuAction: () => () => {},
        onTrackpadScrollBegin: () => () => {},
        onTrackpadScrollEnd: () => () => {},
        onWindowFullscreenStateChange: (listener: (fullscreen: boolean) => void) => {
          notifyFullscreen = listener;
          return () => {
            notifyFullscreen = undefined;
          };
        },
      });
      await using screen = await render(
        <AppSidebarLayout>
          <SidebarInset className="h-dvh">
            <header>Workspace</header>
            <WorkspaceTitlebarControls
              showMaximizeControl={false}
              rightPanelOpen={false}
              animationsActive={false}
              maximized={false}
              onToggleMaximized={() => {}}
            >
              <button type="button">Right panel</button>
            </WorkspaceTitlebarControls>
          </SidebarInset>
        </AppSidebarLayout>,
      );
      const wrapper = screen.container.querySelector('[data-slot="sidebar-wrapper"]')!;
      const topElements = [
        screen.getByText("Workspace").element(),
        wrapper.querySelector('[data-slot="sidebar-container"]')!,
        wrapper.querySelector("[data-sidebar-control]")!,
        wrapper.querySelector("[data-workspace-titlebar-controls]")!,
      ];
      const positions = () => topElements.map((element) => element.getBoundingClientRect().top);
      const assertLayout = (top: number) => {
        expect(positions()).toEqual([top, top, top, top]);
        expect(wrapper.querySelector("main")!.getBoundingClientRect().bottom).toBe(800);
        expect(topElements[1]!.getBoundingClientRect().bottom).toBe(800);
      };

      assertLayout(0);
      expect(notifyFullscreen !== undefined).toBe(platform === "MacIntel");
      await act(() => notifyFullscreen?.(true));
      assertLayout(fullscreenTop);
      expect(getComputedStyle(wrapper).getPropertyValue("--workspace-controls-left")).toBe(
        controlsLeft,
      );
      await act(() => notifyFullscreen?.(false));
      assertLayout(0);
    },
  );
});
