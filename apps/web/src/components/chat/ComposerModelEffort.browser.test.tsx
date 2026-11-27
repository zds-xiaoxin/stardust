import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ComposerEffortColumn, describeComposerEffort } from "./ComposerModelEffort";
import type { TraitsSelectionInput } from "./TraitsPicker";

// Shaped like Devin over ACP: its session mode comes first, and its reasoning id is its own.
const models: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "fusion",
    name: "Fusion (Claude Opus 5.5 Medium + SWE-2 High)",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        {
          id: "mode",
          label: "Session Mode",
          type: "select",
          currentValue: "bypass",
          options: [
            { id: "code", label: "Code" },
            { id: "plan", label: "Plan" },
            { id: "bypass", label: "Bypass Permissions" },
          ],
        },
        {
          id: "thought_level",
          label: "Thinking",
          type: "select",
          role: "reasoning",
          currentValue: "medium",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
        },
        {
          id: "speed",
          label: "Speed",
          type: "select",
          currentValue: "standard",
          options: [
            { id: "standard", label: "Standard" },
            { id: "fast", label: "Fast" },
          ],
        },
        { id: "auto_approve", label: "Auto-approve tools", type: "boolean", currentValue: false },
      ],
    }),
  },
];

function traitsInput(
  modelOptions: ReadonlyArray<ProviderOptionSelection>,
  onModelOptionsChange: (next: ReadonlyArray<ProviderOptionSelection> | undefined) => void,
): TraitsSelectionInput {
  return {
    provider: ProviderDriverKind.make("acpRegistry"),
    instanceId: ProviderInstanceId.make("devin"),
    models,
    model: "fusion",
    modelOptions,
    onModelOptionsChange,
  };
}

function Column() {
  const [options, setOptions] = useState<ReadonlyArray<ProviderOptionSelection>>([]);
  const traits = traitsInput(options, (next) => setOptions(next ?? []));
  return (
    <>
      <div data-model-picker-effort>
        <ComposerEffortColumn traits={traits} />
      </div>
      <p role="status">{describeComposerEffort(traits, "bars", "sm").suffix}</p>
    </>
  );
}

it("draws an agent's reasoning as bars and keeps its mode out of the levels", async () => {
  await using screen = await render(<Column />, { router: false }); // no routes involved
  const status = screen.getByRole("status");
  expect(status.element().querySelector("[data-composer-effort-glyph]")).not.toBeNull();
  await expect.element(status).toHaveTextContent("");

  const slider = screen.getByRole("slider", { name: "Reasoning effort" });
  await expect.element(slider).toHaveAttribute("aria-valuemax", "2");
  const band = slider.element().querySelector(".gx-ch")!;
  const row = slider.element().closest(".gx")!;
  expect(band.getBoundingClientRect().height).toBe(32);
  expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(62);
  expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(64);
  expect(band.getBoundingClientRect().width / row.getBoundingClientRect().width).toBeCloseTo(
    0.58,
    1,
  );
  await expect.element(screen.getByRole("radio", { name: "Plan" })).not.toBeInTheDocument();

  await userEvent.tab();
  await expect.element(slider).toHaveFocus();
  const firstOther = screen.getByRole("button", { name: "Session Mode: Bypass Permissions" });
  (firstOther.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowDown}");
  const speed = screen.getByRole("button", { name: "Speed: Standard" });
  await expect.element(speed).toHaveFocus();
  await expect.element(page.getByRole("menuitemradio")).not.toBeInTheDocument();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("menuitemradio", { name: "Standard" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(page.getByRole("menuitemradio")).not.toBeInTheDocument();
  await expect.element(speed).toHaveFocus();

  await userEvent.click(screen.getByText("Auto-approve tools"));
  await expect
    .element(screen.getByRole("switch", { name: "Auto-approve tools" }))
    .toHaveAttribute("aria-checked", "true");

  await userEvent.click(screen.getByRole("button", { name: "Session Mode: Bypass Permissions" }));
  await userEvent.click(page.getByRole("menuitemradio", { name: "Plan" }));
  await expect
    .element(screen.getByRole("button", { name: "Session Mode: Plan" }))
    .toBeInTheDocument();
  await expect.element(page.getByRole("menuitemradio")).not.toBeInTheDocument();
});

it("selects reasoning levels with keyboard arrows and Home and End", async () => {
  await using screen = await render(<Column />, { router: false });
  const slider = screen.getByRole("slider", { name: "Reasoning effort" });
  await userEvent.tab();
  await expect.element(slider).toHaveFocus();
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Medium");

  await userEvent.keyboard("{ArrowDown}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Low");
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Medium");
  await userEvent.keyboard("{End}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await userEvent.keyboard("{Home}");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "Low");
  await expect.element(slider).toHaveFocus();
});

it("follows a held pointer between stops and settles on the selected level after release", async () => {
  await using screen = await render(<Column />, { router: false });
  const slider = screen.getByRole("slider", { name: "Reasoning effort" });
  const stage = slider.element() as HTMLElement;
  const thumb = stage.querySelector(".gx-thumb")!;
  const width = stage.getBoundingClientRect().width;
  const x = Math.round(width * 0.44);
  const thumbCenter = () => {
    const box = thumb.getBoundingClientRect();
    return box.left + box.width / 2 - stage.getBoundingClientRect().left;
  };
  const eye = stage.querySelector("[data-eye] path")!;
  let heldExpression: string | null;
  await userEvent.hover(slider, { position: { x: 22, y: 22 } });
  await commands.pointerDown();
  try {
    await userEvent.hover(slider, { position: { x, y: 22 } });
    await expect.poll(thumbCenter).toBeCloseTo(x, 0);
    heldExpression = eye.getAttribute("d");
    await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  } finally {
    await commands.pointerUp();
  }
  await expect.poll(thumbCenter).toBeCloseTo(width / 2, 0);
  // The same High selection has a different face between stops than at its detent.
  expect(eye.getAttribute("d")).not.toEqual(heldExpression);
  await expect.element(slider).toHaveAttribute("aria-valuetext", "High");
  await expect.element(slider).toHaveFocus();
});

it("keeps the full reasoning label visible at the model picker's width", async () => {
  const container = document.createElement("div");
  container.style.cssText = "box-sizing:border-box;width:386px;padding:12px";
  await using screen = await render(<Column />, { container, router: false });
  const slider = screen.getByRole("slider", { name: "Reasoning effort" });
  const row = slider.element().closest(".gx")!;
  const label = row.querySelector(".gx-t") as HTMLElement;
  const value = row.querySelector(".gx-v") as HTMLElement;
  expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
  expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
  expect(
    slider.element().querySelector(".gx-ch")!.getBoundingClientRect().width /
      row.getBoundingClientRect().width,
  ).toBeCloseTo(0.58, 1);
});
