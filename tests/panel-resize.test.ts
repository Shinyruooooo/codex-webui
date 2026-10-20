import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { calculatePanelWidthLimits, clampPanelWidth, createPanelResizer } from "../public/panel-resize.js";

function setup({ width = 340, limits = { min: 280, max: 960 } as { min: number; max: number }, onResize, onCommit, onDragEnd } = {}) {
  const dom = new JSDOM("<!doctype html><html><body><button id='focus'></button><div id='handle' role='separator' tabindex='0'></div></body></html>", { url: "http://localhost" });
  const { document, Event } = dom.window;
  const handle = document.querySelector<HTMLElement>("#handle")!;
  let currentWidth = width;
  let captured: number | null = null;
  handle.setPointerCapture = ((id: number) => { captured = id; }) as typeof handle.setPointerCapture;
  handle.hasPointerCapture = ((id: number) => captured === id) as typeof handle.hasPointerCapture;
  handle.releasePointerCapture = ((id: number) => { if (captured === id) captured = null; }) as typeof handle.releasePointerCapture;
  const resizer = createPanelResizer({
    handle,
    getWidth: () => currentWidth,
    getLimits: () => limits,
    onResize: (value) => { currentWidth = value; onResize?.(value); },
    onCommit,
    onDragEnd,
  });
  function pointer(target: EventTarget, type: string, values: Record<string, unknown> = {}) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ pointerId: 1, isPrimary: true, button: 0, clientX: 100, ...values })) {
      Object.defineProperty(event, key, { value });
    }
    target.dispatchEvent(event);
    return event;
  }
  return { dom, document, handle, resizer, pointer, get width() { return currentWidth; }, get captured() { return captured; } };
}

describe("right panel width helpers", () => {
  test("clamps values and falls back safely for invalid values", () => {
    expect(clampPanelWidth(100, { min: 280, max: 960 })).toBe(280);
    expect(clampPanelWidth(1200, { min: 280, max: 960 })).toBe(960);
    expect(clampPanelWidth(Number.NaN, { min: 280, max: 960 })).toBe(340);
    expect(clampPanelWidth("not a width", { min: 280, max: 960 }, 500)).toBe(500);
  });

  test("respects viewport, sidebar and content width without overflow", () => {
    expect(calculatePanelWidthLimits({ viewportWidth: 1440, sidebarWidth: 260 })).toEqual({ min: 280, max: 756 });
    expect(calculatePanelWidthLimits({ viewportWidth: 700, sidebarWidth: 250 })).toEqual({ min: 26, max: 26 });
    expect(calculatePanelWidthLimits({ viewportWidth: 300, sidebarWidth: 400 })).toEqual({ min: 0, max: 0 });
  });

  test("overlay panels can cover content but remain within viewport and gutter", () => {
    expect(calculatePanelWidthLimits({ viewportWidth: 700, sidebarWidth: 250, overlay: true })).toEqual({ min: 280, max: 676 });
    expect(calculatePanelWidthLimits({ viewportWidth: 200, overlay: true })).toEqual({ min: 176, max: 176 });
  });
});

describe("createPanelResizer", () => {
  test("dragging left widens and pointerup commits and cleans up", () => {
    const resized: number[] = [];
    const committed: number[] = [];
    const ended: unknown[] = [];
    const ctx = setup({ onResize: (width) => resized.push(width), onCommit: (width) => committed.push(width), onDragEnd: (event) => ended.push(event) });
    const focus = ctx.document.querySelector<HTMLElement>("#focus")!;
    focus.focus();
    ctx.pointer(ctx.handle, "pointerdown", { clientX: 200, pointerId: 7 });
    expect(ctx.captured).toBe(7);
    expect(ctx.document.body.classList.contains("resizing-right-panel")).toBe(true);
    ctx.pointer(ctx.document, "pointermove", { clientX: 150, pointerId: 7 });
    expect(ctx.width).toBe(390);
    expect(resized).toEqual([390]);
    ctx.pointer(ctx.document, "pointerup", { clientX: 150, pointerId: 7 });
    expect(committed).toEqual([390]);
    expect(ended).toEqual([{ previousFocusedElement: focus, cancelled: false }]);
    expect(ctx.captured).toBeNull();
    expect(ctx.document.body.classList.contains("resizing-right-panel")).toBe(false);
    expect(ctx.handle.getAttribute("aria-valuenow")).toBe("390");
    expect(ctx.handle.getAttribute("aria-valuetext")).toBe("390px");
    ctx.resizer.destroy();
    ctx.dom.window.close();
  });

  test("ignores non-primary pointers and non-primary buttons", () => {
    const ctx = setup();
    ctx.pointer(ctx.handle, "pointerdown", { isPrimary: false });
    ctx.pointer(ctx.handle, "pointerdown", { button: 1 });
    expect(ctx.document.body.classList.contains("resizing-right-panel")).toBe(false);
    expect(ctx.captured).toBeNull();
    ctx.resizer.destroy();
    ctx.dom.window.close();
  });

  test("pointercancel rolls width back and reports prior focus", () => {
    const onDragEnd = (event: unknown) => ended.push(event);
    const ended: unknown[] = [];
    const ctx = setup({ onDragEnd });
    const focus = ctx.document.querySelector<HTMLElement>("#focus")!;
    focus.focus();
    ctx.pointer(ctx.handle, "pointerdown", { pointerId: 2 });
    ctx.pointer(ctx.document, "pointermove", { pointerId: 2, clientX: 40 });
    ctx.pointer(ctx.document, "pointercancel", { pointerId: 2 });
    expect(ctx.width).toBe(340);
    expect(ended).toEqual([{ previousFocusedElement: focus, cancelled: true }]);
    expect(ctx.document.body.classList.contains("resizing-right-panel")).toBe(false);
    expect(ctx.captured).toBeNull();
    ctx.resizer.destroy();
    ctx.dom.window.close();
  });

  test("blur cancels active drag; destroy releases capture and removes listeners", () => {
    const ctx = setup();
    ctx.pointer(ctx.handle, "pointerdown", { pointerId: 3 });
    ctx.pointer(ctx.document, "pointermove", { pointerId: 3, clientX: 80 });
    ctx.dom.window.dispatchEvent(new ctx.dom.window.Event("blur"));
    expect(ctx.width).toBe(340);
    expect(ctx.document.body.classList.contains("resizing-right-panel")).toBe(false);
    ctx.pointer(ctx.handle, "pointerdown", { pointerId: 4 });
    expect(ctx.captured).toBe(4);
    ctx.resizer.destroy();
    expect(ctx.captured).toBeNull();
    expect(ctx.document.body.classList.contains("resizing-right-panel")).toBe(false);
    ctx.pointer(ctx.document, "pointermove", { pointerId: 4, clientX: 0 });
    expect(ctx.width).toBe(340);
    ctx.dom.window.close();
  });

  test("lost pointer capture reliably cancels the drag", () => {
    const ctx = setup();
    ctx.pointer(ctx.handle, "pointerdown", { pointerId: 5 });
    ctx.pointer(ctx.document, "pointermove", { pointerId: 5, clientX: 50 });
    ctx.pointer(ctx.handle, "lostpointercapture", { pointerId: 5 });
    expect(ctx.width).toBe(340);
    expect(ctx.document.body.classList.contains("resizing-right-panel")).toBe(false);
    ctx.resizer.destroy();
    ctx.dom.window.close();
  });

  test("keyboard resizes with shift acceleration, Home/End, and double-click reset", () => {
    const committed: Array<[number, unknown]> = [];
    const ctx = setup({ width: 400, limits: { min: 280, max: 500 }, onCommit: (width, meta) => committed.push([width, meta]) });
    ctx.handle.dispatchEvent(new ctx.dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(ctx.width).toBe(410);
    ctx.handle.dispatchEvent(new ctx.dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true, cancelable: true }));
    expect(ctx.width).toBe(460);
    ctx.handle.dispatchEvent(new ctx.dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(ctx.width).toBe(500);
    ctx.handle.dispatchEvent(new ctx.dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(ctx.width).toBe(280);
    ctx.handle.dispatchEvent(new ctx.dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(ctx.width).toBe(340);
    expect(committed.map(([width]) => width)).toEqual([410, 460, 500, 280, 340]);
    expect(ctx.handle.getAttribute("aria-valuemin")).toBe("280");
    expect(ctx.handle.getAttribute("aria-valuemax")).toBe("500");
    expect(ctx.handle.getAttribute("aria-valuenow")).toBe("340");
    ctx.resizer.destroy();
    ctx.dom.window.close();
  });

  test("malformed measurements never propagate NaN", () => {
    const ctx = setup({ width: Number.NaN, limits: { min: Number.NaN, max: Number.NaN } });
    expect(Number.isFinite(Number(ctx.handle.getAttribute("aria-valuenow")))).toBe(true);
    ctx.pointer(ctx.handle, "pointerdown", { pointerId: 9 });
    ctx.pointer(ctx.document, "pointermove", { pointerId: 9, clientX: Number.NaN });
    expect(Number.isFinite(ctx.width)).toBe(true);
    expect(ctx.handle.getAttribute("aria-valuenow")).not.toContain("NaN");
    ctx.pointer(ctx.document, "pointerup", { pointerId: 9 });
    ctx.resizer.destroy();
    ctx.dom.window.close();
  });
});
