import { codexIconSvg } from "./codex-icons.js";

const FEEDBACK_MS = 1500;

function makeIcon(document, name) {
  const slot = document.createElement("span");
  slot.className = "icon-slot";
  // The icon name is a fixed internal constant; never pass message/user text here.
  slot.innerHTML = codexIconSvg(name);
  return slot;
}

function readSelection(document, activeElement) {
  let ranges = [];
  try {
    const selection = document.getSelection?.();
    if (selection) ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
  } catch {}

  let controlSelection = null;
  try {
    if (typeof activeElement?.selectionStart === "number" && typeof activeElement?.selectionEnd === "number") {
      controlSelection = {
        start: activeElement.selectionStart,
        end: activeElement.selectionEnd,
        direction: activeElement.selectionDirection || "none",
      };
    }
  } catch {}
  return { ranges, controlSelection };
}

function restoreFocusAndSelection(document, activeElement, saved) {
  if (activeElement?.isConnected && typeof activeElement.focus === "function") {
    try { activeElement.focus({ preventScroll: true }); }
    catch { try { activeElement.focus(); } catch {} }
  }

  if (saved.controlSelection && typeof activeElement?.setSelectionRange === "function") {
    try {
      activeElement.setSelectionRange(saved.controlSelection.start, saved.controlSelection.end, saved.controlSelection.direction);
    } catch {}
  }

  try {
    const selection = document.getSelection?.();
    if (selection) {
      selection.removeAllRanges();
      for (const range of saved.ranges) selection.addRange(range);
    }
  } catch {}
}

async function fallbackCopy(text, document) {
  const activeElement = document?.activeElement;
  const host = activeElement?.closest?.("dialog[open]") || document?.querySelector?.("dialog[open]") || document?.body;
  if (!document?.createElement || !host?.appendChild) return false;
  const saved = readSelection(document, activeElement);
  const textarea = document.createElement("textarea");
  textarea.readOnly = true;
  textarea.spellcheck = false;
  textarea.setAttribute("autocomplete", "off");
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-10000px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  textarea.value = text;

  let succeeded = false;
  try {
    host.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    succeeded = typeof document.execCommand === "function" && document.execCommand("copy") === true;
  } catch {
    succeeded = false;
  } finally {
    textarea.remove();
    restoreFocusAndSelection(document, activeElement, saved);
  }
  return succeeded;
}

export async function copyTextToClipboard(text, options = {}) {
  if (typeof text !== "string" || text.length === 0) return false;
  const document = options.document ?? globalThis.document;
  const navigator = options.navigator ?? document?.defaultView?.navigator ?? globalThis.navigator;
  const secureContext = document?.defaultView?.isSecureContext ?? globalThis.isSecureContext;
  if (secureContext !== false) {
    try {
      const clipboard = navigator?.clipboard;
      if (typeof clipboard?.writeText === "function") {
        await clipboard.writeText(text);
        return true;
      }
    } catch {
      // Permission and platform errors fall through to the legacy DOM copy path.
    }
  }
  return fallbackCopy(text, document);
}

function safeTranslate(translate, value) {
  try {
    const translated = translate(value);
    return typeof translated === "string" ? translated : value;
  } catch {
    return value;
  }
}

function currentText(getText) {
  try {
    const value = getText();
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export function createMessageActions({ translate = (value) => value, onCopyResult = () => {}, copyText = copyTextToClipboard } = {}) {
  const messageActions = new WeakMap();
  const codeActions = new WeakMap();
  const buttonStates = new WeakMap();

  function setButtonLabel(button, label) {
    const translated = safeTranslate(translate, label);
    button.title = translated;
    button.setAttribute("aria-label", translated);
  }

  function refreshLabels(root) {
    if (!root) return;
    const buttons = [];
    if (root.matches?.("button[data-i18n-ui]")) buttons.push(root);
    buttons.push(...(root.querySelectorAll?.("button[data-i18n-ui]") || []));
    for (const button of buttons) {
      const state = buttonStates.get(button);
      if (state) setButtonLabel(button, state.copied ? "Copied" : state.copyLabel);
    }
  }

  function resetButton(button, state) {
    if (state.timer != null) clearTimeout(state.timer);
    state.timer = null;
    state.generation += 1;
    state.copied = false;
    delete button.dataset.copied;
    button.replaceChildren(makeIcon(button.ownerDocument, "copy"));
    setButtonLabel(button, state.copyLabel);
  }

  function createCopyButton(document, kind, label, getSource) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-action-button";
    button.dataset.copyKind = kind;
    button.dataset.i18nUi = label;
    const state = { timer: null, generation: 0, copyLabel: label, pending: false, copied: false };
    buttonStates.set(button, state);
    button.appendChild(makeIcon(document, "copy"));
    setButtonLabel(button, label);

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.pending) return;
      resetButton(button, state);
      state.pending = true;
      const generation = state.generation;
      let success = false;
      try {
        const text = getSource();
        if (typeof text === "string" && text.length > 0) {
          const ownerDocument = button.ownerDocument;
          success = await copyText(text, {
            document: ownerDocument,
            navigator: ownerDocument.defaultView?.navigator,
          }) === true;
        }
      } catch {
        success = false;
      } finally {
        state.pending = false;
      }

      try { onCopyResult(success); } catch {}
      if (!success || generation !== state.generation) return;
      state.copied = true;
      button.dataset.copied = "true";
      button.replaceChildren(makeIcon(button.ownerDocument, "check"));
      setButtonLabel(button, "Copied");
      state.timer = setTimeout(() => {
        if (generation !== state.generation) return;
        state.timer = null;
        state.copied = false;
        delete button.dataset.copied;
        button.replaceChildren(makeIcon(button.ownerDocument, "copy"));
        setButtonLabel(button, state.copyLabel);
      }, FEEDBACK_MS);
    });
    return button;
  }

  function updateMessageCopy(root, getText) {
    if (!root || typeof root.appendChild !== "function" || typeof getText !== "function") return;
    let record = messageActions.get(root);
    if (!record) {
      const container = root.ownerDocument.createElement("div");
      container.className = "message-copy-actions";
      const button = createCopyButton(root.ownerDocument, "message", "Copy message", () => currentText(record.getText));
      container.appendChild(button);
      root.appendChild(container);
      record = { container, button, getText };
      messageActions.set(root, record);
    } else {
      record.getText = getText;
      if (record.container.parentNode !== root) root.appendChild(record.container);
    }
    record.container.hidden = currentText(record.getText).length === 0;
  }

  function enhanceCodeBlocks(root) {
    if (!root?.querySelectorAll) return;
    for (const code of root.querySelectorAll("pre > code")) {
      const pre = code.parentElement;
      if (!pre || pre.tagName !== "PRE") continue;
      let record = codeActions.get(pre);
      if (record) {
        if (pre.parentNode !== record.wrapper) {
          const parent = pre.parentNode;
          if (!parent) continue;
          parent.insertBefore(record.wrapper, pre);
          record.wrapper.appendChild(pre);
        }
        continue;
      }

      const parent = pre.parentNode;
      if (!parent) continue;
      const document = pre.ownerDocument;
      const wrapper = document.createElement("div");
      wrapper.className = "code-block-copy";
      const toolbar = document.createElement("div");
      toolbar.className = "code-block-copy-toolbar";
      const button = createCopyButton(document, "code", "Copy code", () => code.textContent || "");
      toolbar.appendChild(button);
      parent.insertBefore(wrapper, pre);
      wrapper.append(toolbar, pre);
      record = { wrapper, toolbar, button };
      codeActions.set(pre, record);
    }
  }

  return { updateMessageCopy, enhanceCodeBlocks, refreshLabels };
}
