const DEFAULT_PANEL_WIDTH = 340;
const DEFAULT_MIN_WIDTH = 280;
const DEFAULT_MAX_WIDTH = 960;
const DEFAULT_MIN_CONTENT_WIDTH = 400;
const DEFAULT_GUTTER = 24;
const RESIZING_CLASS = "resizing-right-panel";

function finiteNumber(value, fallback) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value, fallback) {
  return Math.max(0, finiteNumber(value, fallback));
}

export function calculatePanelWidthLimits({
  viewportWidth,
  sidebarWidth = 0,
  overlay = false,
  minWidth = DEFAULT_MIN_WIDTH,
  maxWidth = DEFAULT_MAX_WIDTH,
  minContentWidth = DEFAULT_MIN_CONTENT_WIDTH,
  gutter = DEFAULT_GUTTER,
} = {}) {
  const viewport = nonNegative(viewportWidth, 0);
  const sidebar = nonNegative(sidebarWidth, 0);
  const content = nonNegative(minContentWidth, DEFAULT_MIN_CONTENT_WIDTH);
  const safeGutter = nonNegative(gutter, DEFAULT_GUTTER);
  const configuredMax = nonNegative(maxWidth, DEFAULT_MAX_WIDTH);
  const configuredMin = nonNegative(minWidth, DEFAULT_MIN_WIDTH);
  const available = Math.max(0, viewport - (overlay ? 0 : sidebar + content) - safeGutter);
  const max = Math.min(configuredMax, available);
  return { min: Math.min(configuredMin, max), max };
}

export function clampPanelWidth(value, limits, fallback = DEFAULT_PANEL_WIDTH) {
  const min = nonNegative(limits?.min, 0);
  const suppliedMax = finiteNumber(limits?.max, min);
  const max = Math.max(min, suppliedMax);
  const safeFallback = finiteNumber(fallback, DEFAULT_PANEL_WIDTH);
  const width = finiteNumber(value, safeFallback);
  return Math.min(max, Math.max(min, width));
}

function safeReadWidth(getWidth) {
  try {
    return typeof getWidth === "function" ? getWidth() : DEFAULT_PANEL_WIDTH;
  } catch {
    return DEFAULT_PANEL_WIDTH;
  }
}

function safeReadLimits(getLimits) {
  try {
    return typeof getLimits === "function" ? getLimits() : { min: 0, max: Number.MAX_SAFE_INTEGER };
  } catch {
    return { min: 0, max: Number.MAX_SAFE_INTEGER };
  }
}

export function createPanelResizer({
  handle,
  getWidth,
  getLimits,
  onResize,
  onCommit,
  onDragEnd,
} = {}) {
  if (!handle || typeof handle.addEventListener !== "function") return { destroy() {} };

  const document = handle.ownerDocument;
  const view = document?.defaultView;
  const body = document?.body;
  let destroyed = false;
  let drag = null;
  let addedBodyClass = false;

  function currentWidth() {
    return clampPanelWidth(safeReadWidth(getWidth), safeReadLimits(getLimits));
  }

  function updateAria(width) {
    const limits = safeReadLimits(getLimits);
    const min = clampPanelWidth(limits?.min, limits, 0);
    const max = Math.max(min, finiteNumber(limits?.max, min));
    const value = clampPanelWidth(width, { min, max });
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(max));
    handle.setAttribute("aria-valuenow", String(value));
    handle.setAttribute("aria-valuetext", `${value}px`);
  }

  function applyWidth(value, { notify = true } = {}) {
    const width = clampPanelWidth(value, safeReadLimits(getLimits));
    updateAria(width);
    if (notify && typeof onResize === "function") onResize(width);
    return width;
  }

  function commit(width, reason) {
    if (typeof onCommit === "function") onCommit(width, { reason });
  }

  function releaseCapture(pointerId) {
    try {
      if (typeof handle.hasPointerCapture === "function" && handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture?.(pointerId);
      }
    } catch {
      // The pointer may already have been released by the browser.
    }
  }

  function finishDrag({ cancelled = false, release = true } = {}) {
    if (!drag) return;
    const finished = drag;
    drag = null;
    if (body && addedBodyClass) body.classList.remove(RESIZING_CLASS);
    addedBodyClass = false;
    if (release) releaseCapture(finished.pointerId);

    if (cancelled) applyWidth(finished.startWidth);
    else commit(currentWidth(), "pointer");
    if (typeof onDragEnd === "function") {
      onDragEnd({ previousFocusedElement: finished.previousFocusedElement, cancelled });
    }
  }

  function onPointerDown(event) {
    if (destroyed || drag || event.isPrimary !== true || event.button !== 0) return;
    const startWidth = currentWidth();
    const pointerId = event.pointerId;
    drag = {
      pointerId,
      startX: finiteNumber(event.clientX, 0),
      startWidth,
      previousFocusedElement: document?.activeElement || null,
    };
    if (body && !body.classList.contains(RESIZING_CLASS)) {
      body.classList.add(RESIZING_CLASS);
      addedBodyClass = true;
    }
    try {
      handle.setPointerCapture?.(pointerId);
    } catch {
      // Document-level pointer listeners remain as a fallback.
    }
    event.preventDefault?.();
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const x = finiteNumber(event.clientX, drag.startX);
    applyWidth(drag.startWidth - (x - drag.startX));
  }

  function onPointerUp(event) {
    if (drag && event.pointerId === drag.pointerId) finishDrag();
  }

  function onPointerCancel(event) {
    if (drag && event.pointerId === drag.pointerId) finishDrag({ cancelled: true });
  }

  function onLostPointerCapture(event) {
    if (drag && event.pointerId === drag.pointerId) finishDrag({ cancelled: true, release: false });
  }

  function onWindowBlur() {
    if (drag) finishDrag({ cancelled: true });
  }

  function onKeyDown(event) {
    if (destroyed) return;
    const limits = safeReadLimits(getLimits);
    const width = currentWidth();
    let next;
    if (event.key === "ArrowLeft") next = width + (event.shiftKey ? 50 : 10);
    else if (event.key === "ArrowRight") next = width - (event.shiftKey ? 50 : 10);
    else if (event.key === "Home") next = finiteNumber(limits?.min, 0);
    else if (event.key === "End") next = finiteNumber(limits?.max, width);
    else return;
    event.preventDefault?.();
    const updated = applyWidth(next);
    commit(updated, "keyboard");
  }

  function onDoubleClick(event) {
    if (destroyed) return;
    event.preventDefault?.();
    const width = applyWidth(DEFAULT_PANEL_WIDTH);
    commit(width, "reset");
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("keydown", onKeyDown);
  handle.addEventListener("dblclick", onDoubleClick);
  handle.addEventListener("lostpointercapture", onLostPointerCapture);
  document?.addEventListener("pointermove", onPointerMove);
  document?.addEventListener("pointerup", onPointerUp);
  document?.addEventListener("pointercancel", onPointerCancel);
  view?.addEventListener("blur", onWindowBlur);
  updateAria(currentWidth());

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (drag) finishDrag({ cancelled: true });
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("keydown", onKeyDown);
      handle.removeEventListener("dblclick", onDoubleClick);
      handle.removeEventListener("lostpointercapture", onLostPointerCapture);
      document?.removeEventListener("pointermove", onPointerMove);
      document?.removeEventListener("pointerup", onPointerUp);
      document?.removeEventListener("pointercancel", onPointerCancel);
      view?.removeEventListener("blur", onWindowBlur);
    },
  };
}
