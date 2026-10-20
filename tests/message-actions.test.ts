import { afterEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { copyTextToClipboard, createMessageActions } from "../public/message-actions.js";

const doms: JSDOM[] = [];

function makeDom(markup = "<main></main>") {
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, { pretendToBeVisual: true });
  doms.push(dom);
  return dom;
}

async function settleClick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  for (const dom of doms.splice(0)) dom.window.close();
});

describe("copyTextToClipboard", () => {
  test("prefers successful native clipboard writes and preserves exact Unicode and whitespace", async () => {
    const dom = makeDom();
    const text = "  第一行\n\t🙂 e\u0301  \n";
    const writes: string[] = [];
    const navigator = { clipboard: { writeText: async (value: string) => { writes.push(value); } } };
    expect(await copyTextToClipboard(text, { document: dom.window.document, navigator })).toBe(true);
    expect(writes).toEqual([text]);
  });

  test("uses the textarea fallback when native clipboard writing rejects", async () => {
    const dom = makeDom();
    const text = "  fallback\n\t漢字";
    let copied = "";
    dom.window.document.execCommand = ((command: string) => {
      expect(command).toBe("copy");
      copied = (dom.window.document.activeElement as HTMLTextAreaElement).value;
      return true;
    }) as typeof dom.window.document.execCommand;
    const navigator = { clipboard: { writeText: async () => { throw new Error("denied"); } } };
    expect(await copyTextToClipboard(text, { document: dom.window.document, navigator })).toBe(true);
    expect(copied).toBe(text);
    expect(dom.window.document.querySelector("textarea")).toBeNull();
  });

  test("a blocked clipboard getter still falls back without leaking an exception", async () => {
    const dom = makeDom();let copies = 0;
    const navigator = Object.defineProperty({}, "clipboard", { get() { throw new Error("fixture policy denied clipboard access"); } });
    dom.window.document.execCommand = (() => { copies++;return true; }) as typeof dom.window.document.execCommand;
    expect(await copyTextToClipboard("fallback remains available", { document: dom.window.document, navigator })).toBe(true);
    expect(copies).toBe(1);
  });

  test("insecure HTTP uses a fully selected textarea without requesting native clipboard permission", async () => {
    const dom = makeDom();
    Object.defineProperty(dom.window, "isSecureContext", { value: false });
    let nativeCalls = 0;const text = "  HTTP 中文\n\tlast line";
    const navigator = { clipboard: { writeText: async () => { nativeCalls++; } } };
    dom.window.document.execCommand = (() => {
      const input = dom.window.document.activeElement as HTMLTextAreaElement;
      expect(input.value).toBe(text);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(text.length);
      expect(input.spellcheck).toBe(false);
      return true;
    }) as typeof dom.window.document.execCommand;
    expect(await copyTextToClipboard(text, { document: dom.window.document, navigator })).toBe(true);
    expect(nativeCalls).toBe(0);
  });

  test("does not copy an empty string or call native/fallback APIs", async () => {
    const dom = makeDom();
    let writes = 0;
    let commands = 0;
    const navigator = { clipboard: { writeText: async () => { writes += 1; } } };
    dom.window.document.execCommand = (() => { commands += 1; return true; }) as typeof dom.window.document.execCommand;
    expect(await copyTextToClipboard("", { document: dom.window.document, navigator })).toBe(false);
    expect(writes).toBe(0);
    expect(commands).toBe(0);
  });

  test("returns false when native and fallback copy both fail", async () => {
    const dom = makeDom();
    dom.window.document.execCommand = (() => false) as typeof dom.window.document.execCommand;
    const navigator = { clipboard: { writeText: async () => { throw new Error("permission denied"); } } };
    expect(await copyTextToClipboard("not copied", { document: dom.window.document, navigator })).toBe(false);
  });

  test("restores active input focus and its selection after fallback", async () => {
    const dom = makeDom('<input id="field" value="abcdef">');
    const document = dom.window.document;
    const input = document.querySelector("input")!;
    input.focus();
    input.setSelectionRange(2, 5, "backward");
    document.execCommand = (() => true) as typeof document.execCommand;
    expect(await copyTextToClipboard("copy me", { document, navigator: {} })).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);
    expect(input.selectionDirection).toBe("backward");
  });

  test("restores a document range selection after fallback", async () => {
    const dom = makeDom("<p id='selectable'>selection text</p>");
    const document = dom.window.document;
    const textNode = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 2);
    range.setEnd(textNode, 7);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const active = document.activeElement;
    document.execCommand = (() => true) as typeof document.execCommand;

    expect(await copyTextToClipboard("fallback", { document, navigator: {} })).toBe(true);
    expect(document.activeElement).toBe(active);
    expect(document.getSelection()?.toString()).toBe("lecti");
  });

  test("attaches the fallback textarea to the active open dialog", async () => {
    const dom = makeDom('<dialog open><input value="stay focused"></dialog>');
    const document = dom.window.document;
    const dialog = document.querySelector("dialog")!;
    dialog.querySelector("input")!.focus();
    let usedDialog = false;
    document.execCommand = (() => {
      usedDialog = dialog.contains(document.activeElement) && dialog.querySelector("textarea") !== null;
      return true;
    }) as typeof document.execCommand;
    expect(await copyTextToClipboard("inside dialog", { document, navigator: {} })).toBe(true);
    expect(usedDialog).toBe(true);
  });

  test("default copy action uses its ownerDocument instead of the global document", async () => {
    const owner = makeDom("<article></article>");
    const unrelated = makeDom("<main></main>");
    let ownerCalls = 0;
    let unrelatedCalls = 0;
    owner.window.document.execCommand = (() => { ownerCalls += 1; return true; }) as typeof owner.window.document.execCommand;
    unrelated.window.document.execCommand = (() => { unrelatedCalls += 1; return false; }) as typeof unrelated.window.document.execCommand;
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { value: unrelated.window.document, configurable: true });
    try {
      const root = owner.window.document.querySelector("article")!;
      const actions = createMessageActions();
      actions.updateMessageCopy(root, () => "uses owner document");
      root.querySelector("button")!.click();
      await settleClick();
      expect(ownerCalls).toBe(1);
      expect(unrelatedCalls).toBe(0);
    } finally {
      if (previous) Object.defineProperty(globalThis, "document", previous);
      else delete (globalThis as any).document;
    }
  });
});

describe("message copy actions", () => {
  test("creates a direct-child action once and reads the latest streamed message on click", async () => {
    const dom = makeDom("<article id='message'><p>first</p></article>");
    const root = dom.window.document.querySelector("article")!;
    let source = "first";
    const copied: string[] = [];
    const actions = createMessageActions({ copyText: async (value) => { copied.push(value); return true; } });
    actions.updateMessageCopy(root, () => source);
    source = "latest  \n🙂";
    actions.updateMessageCopy(root, () => source);

    const buttons = root.querySelectorAll('button[data-copy-kind="message"]');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].type).toBe("button");
    expect(root.querySelectorAll(":scope > .message-copy-actions")).toHaveLength(1);
    buttons[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await settleClick();
    expect(copied).toEqual(["latest  \n🙂"]);
  });

  test("hides copy for empty messages and does not add label text to message content", () => {
    const dom = makeDom("<article id='message'><p>original</p></article>");
    const root = dom.window.document.querySelector("article")!;
    const originalText = root.textContent;
    const actions = createMessageActions();
    actions.updateMessageCopy(root, () => "");
    const container = root.querySelector(".message-copy-actions") as HTMLDivElement;
    expect(container.hidden).toBe(true);
    expect(root.textContent).toBe(originalText);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Copy message");
    expect(container.querySelector("button")?.textContent).toBe("");
  });

  test("uses translated accessible labels without button text", () => {
    const dom = makeDom("<article></article>");
    const root = dom.window.document.querySelector("article")!;
    const actions = createMessageActions({ translate: (label) => `译:${label}` });
    actions.updateMessageCopy(root, () => "正文");
    const button = root.querySelector("button")!;
    expect(button.title).toBe("译:Copy message");
    expect(button.getAttribute("aria-label")).toBe("译:Copy message");
    expect(button.dataset.i18nUi).toBe("Copy message");
    expect(button.textContent).toBe("");
  });

  test("refreshes message and copied labels after a language switch", async () => {
    const dom = makeDom("<article></article>");
    const root = dom.window.document.querySelector("article")!;
    let language = "zh";
    const labels: Record<string, Record<string, string>> = {
      zh: { "Copy message": "复制消息", Copied: "已复制" },
      en: { "Copy message": "Copy message", Copied: "Copied" },
    };
    const actions = createMessageActions({
      translate: (label) => labels[language][label] || label,
      copyText: async () => true,
    });
    actions.updateMessageCopy(root, () => "正文");
    const button = root.querySelector("button")!;
    expect(button.title).toBe("复制消息");
    button.click();
    await settleClick();
    expect(button.title).toBe("已复制");
    expect(button.dataset.copied).toBe("true");

    language = "en";
    actions.refreshLabels(root);
    expect(button.title).toBe("Copied");
    expect(button.getAttribute("aria-label")).toBe("Copied");
    expect(button.dataset.copied).toBe("true");
  });

  test("sets copied state on success and clears it when another copy starts", async () => {
    const dom = makeDom("<article></article>");
    const root = dom.window.document.querySelector("article")!;
    let calls = 0;
    const actions = createMessageActions({ copyText: async () => ++calls === 1 });
    actions.updateMessageCopy(root, () => "正文");
    const button = root.querySelector("button")!;
    button.click();
    await settleClick();
    expect(button.dataset.copied).toBe("true");

    button.click();
    expect(button.dataset.copied).toBeUndefined();
    expect(button.title).toBe("Copy message");
    await settleClick();
    expect(button.dataset.copied).toBeUndefined();
  });

  test("does not interpret source strings containing HTML as markup", async () => {
    const dom = makeDom("<article></article>");
    const root = dom.window.document.querySelector("article")!;
    const html = '<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>';
    let copied = "";
    const actions = createMessageActions({ copyText: async (text) => { copied = text; return true; } });
    actions.updateMessageCopy(root, () => html);
    root.querySelector("button")!.click();
    await settleClick();
    expect(copied).toBe(html);
    expect(root.querySelector("script, img")).toBeNull();
    expect((dom.window as any).pwned).toBeUndefined();
  });

  test("reports copy failure without showing successful feedback", async () => {
    const dom = makeDom("<article></article>");
    const root = dom.window.document.querySelector("article")!;
    const results: boolean[] = [];
    const actions = createMessageActions({ copyText: async () => false, onCopyResult: (success) => results.push(success) });
    actions.updateMessageCopy(root, () => "text");
    const button = root.querySelector("button")!;
    button.click();
    await settleClick();
    expect(results).toEqual([false]);
    expect(button.title).toBe("Copy message");
    expect(button.querySelector("path")?.getAttribute("d")).not.toBe("M20 6 9 17l-5-5");
  });

  test("enhances multiple code blocks independently and does not copy toolbar text", async () => {
    const dom = makeDom("<article><pre><code>  const a = '一';\n</code></pre><pre><code>  echo second\n</code></pre></article>");
    const root = dom.window.document.querySelector("article")!;
    const before = root.textContent;
    const copied: string[] = [];
    const actions = createMessageActions({ copyText: async (text) => { copied.push(text); return true; } });
    actions.enhanceCodeBlocks(root);
    actions.enhanceCodeBlocks(root);
    const buttons = root.querySelectorAll('button[data-copy-kind="code"]');
    expect(buttons).toHaveLength(2);
    expect(root.querySelectorAll(".code-block-copy")).toHaveLength(2);
    expect(root.querySelectorAll(".code-block-copy-toolbar")).toHaveLength(2);
    expect(root.textContent).toBe(before);

    buttons[0].click();
    buttons[1].click();
    await settleClick();
    expect(copied).toEqual(["  const a = '一';\n", "  echo second\n"]);
  });

  test("code buttons use button type and re-enhances newly rendered pre nodes", () => {
    const dom = makeDom("<article><pre><code>one</code></pre></article>");
    const root = dom.window.document.querySelector("article")!;
    const actions = createMessageActions();
    actions.enhanceCodeBlocks(root);
    const oldPre = root.querySelector("pre")!;
    expect(root.querySelector('button[data-copy-kind="code"]')?.type).toBe("button");
    root.innerHTML = "<pre><code>two</code></pre>";
    actions.enhanceCodeBlocks(root);
    expect(root.querySelectorAll(".code-block-copy")).toHaveLength(1);
    expect(root.querySelector("pre")).not.toBe(oldPre);
  });

  test("shows a retry control only for a failed message and resends that message", () => {
    const dom = makeDom("<article><p>original</p></article>");
    const root = dom.window.document.querySelector("article")!;
    const actions = createMessageActions({ translate: (label) => label === "Retry message" ? "重试这条消息" : label });
    let retries = 0;
    actions.updateMessageRetry(root, { visible: false, error: "hidden", onRetry: () => { retries += 1; } });
    expect(root.querySelector(".message-retry-actions")?.hidden).toBe(true);
    expect(root.classList.contains("failed")).toBe(false);

    actions.updateMessageRetry(root, { visible: true, error: "Codex error <img>", disabled: false, onRetry: () => { retries += 1; } });
    const button = root.querySelector(".message-retry-button") as HTMLButtonElement;
    const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    let bubbled = false;
    root.addEventListener("click", () => { bubbled = true; });
    button.dispatchEvent(event);
    expect(retries).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("重试这条消息");
    expect(button.title).toBe("重试这条消息: Codex error <img>");
    expect(button.querySelector(".message-retry-label")).toBeNull();
    expect(root.querySelector(".message-retry-error")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("button[data-copy-kind='message']")).toBeNull();

    actions.updateMessageRetry(root, { visible: true, disabled: true, error: "busy", onRetry: () => { retries += 1; } });
    button.click();
    expect(retries).toBe(1);
    expect(button.disabled).toBe(true);
  });

  test("prevents click default and propagation", () => {
    const dom = makeDom("<article><pre><code>x</code></pre></article>");
    const root = dom.window.document.querySelector("article")!;
    const actions = createMessageActions({ copyText: async () => true });
    actions.enhanceCodeBlocks(root);
    let bubbled = false;
    root.addEventListener("click", () => { bubbled = true; });
    const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    root.querySelector("button")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(bubbled).toBe(false);
  });
});
