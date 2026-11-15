import { createElement as h } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapInfoPanel, type PanelContent } from "./MapInfoPanel";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
});

const content = (key: string, extra: Partial<PanelContent> = {}): PanelContent => ({
  key,
  icon: "pin",
  tone: "rose",
  kicker: "Map location",
  title: `Title ${key}`,
  body: h("div", { style: { height: "2000px" } }, "long text"),
  actions: h("button", { className: "act" }, "Set Destination"),
  ...extra,
});

function render(c: PanelContent | null, layout: "side" | "sheet", onClose = vi.fn()) {
  if (!host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root!.render(h(MapInfoPanel, { content: c, layout, width: 340, map: null, onClose })));
  return onClose;
}

describe("MapInfoPanel", () => {
  it("renders nothing without a selection", () => {
    render(null, "side");
    expect(document.querySelector("[data-testid=map-info]")).toBeNull();
  });

  it("shows the title, a labelled close button and the actions; focuses itself when it opens", () => {
    render(content("a"), "side");
    const el = document.querySelector<HTMLElement>("[data-testid=map-info]")!;
    expect(el.getAttribute("aria-labelledby")).toBe("map-info-title");
    expect(el.querySelector("h2")!.textContent).toBe("Title a");
    expect(el.querySelector(".mi-close")!.getAttribute("aria-label")).toMatch(/Close/);
    expect(el.querySelector(".mi-actions .act")).toBeTruthy();
    expect(document.activeElement).toBe(el);
    expect(el.style.width).toBe("340px");
  });

  it("closes with the close button and with Escape, but not with Escape typed in a text field", () => {
    const onClose = render(content("a"), "side");
    act(() => document.querySelector<HTMLElement>(".mi-close")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(2);
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
    input.remove();
  });

  it("starts a new selection at the top of its body, but keeps the scroll for the same selection", () => {
    render(content("a"), "side");
    const body = document.querySelector<HTMLElement>(".mi-body")!;
    body.scrollTop = 300;
    render(content("a"), "side"); // same selection re-rendered (e.g. mouse move)
    expect(body.scrollTop).toBe(300);
    render(content("b"), "side");
    expect(document.querySelector<HTMLElement>(".mi-body")!.scrollTop).toBe(0);
  });

  it("is a bottom sheet with a drag handle on phones", () => {
    render(content("a"), "sheet");
    const el = document.querySelector<HTMLElement>("[data-testid=map-info]")!;
    expect(el.classList.contains("mi-sheet")).toBe(true);
    expect(el.dataset.layout).toBe("sheet");
    const handle = el.querySelector<HTMLButtonElement>(".mi-handle button")!;
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    act(() => handle.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }))); // keyboard activation
    expect(el.classList.contains("is-expanded")).toBe(true);
  });
});
