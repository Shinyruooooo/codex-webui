import { describe, expect, test } from "bun:test";
import {
  CHAT_IMAGE_LIMIT,
  inlineImageUrl,
  isChatImageFile,
  readChatImageFile,
  shouldDownscaleChatImage,
} from "../public/chat-images.js";

describe("chat images", () => {
  test("recognizes conversation images without treating ordinary files as images", () => {
    expect(isChatImageFile({ type: "image/png", name: "shot.png" })).toBe(true);
    expect(isChatImageFile({ type: "", name: "diagram.JPEG" })).toBe(true);
    expect(isChatImageFile({ type: "text/plain", name: "spec.txt" })).toBe(false);
    expect(CHAT_IMAGE_LIMIT).toBe(10);
  });

  test("builds only safe inline image URLs", () => {
    expect(inlineImageUrl({ mimeType: "image/png", data: "abc+/=" })).toBe("data:image/png;base64,abc+/=");
    expect(inlineImageUrl({ url: "data:image/png;base64,abc" })).toBe("data:image/png;base64,abc");
    expect(inlineImageUrl({ url: "https://example.test/a.png" })).toBe("");
    expect(inlineImageUrl({ mimeType: "text/plain", data: "abc" })).toBe("");
  });

  test("keeps small images intact and downscales only large non-GIF images", async () => {
    const file = { type: "image/png", name: "shot.png", size: 12, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    expect(shouldDownscaleChatImage(file)).toBe(false);
    expect(shouldDownscaleChatImage({ type: "image/gif", size: 2_000_000 })).toBe(false);
    expect(shouldDownscaleChatImage({ type: "image/png", size: 2_000_000 })).toBe(true);
    const image = await readChatImageFile(file, { readDataUrl: async () => "data:image/png;base64,abc", skipResize: true });
    expect(image).toMatchObject({ kind: "image", isImage: true, mimeType: "image/png", data: "abc", filename: "shot.png" });
    expect(image.previewUrl).toBe("data:image/png;base64,abc");
    await expect(readChatImageFile({ type: "text/plain", name: "spec.txt", size: 4 })).rejects.toThrow("Unsupported image type");
  });
});
