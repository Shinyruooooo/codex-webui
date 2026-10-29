import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readVerifiedLocalImage, resolveLocalImage } from "../server/image-service.js";

describe("local agent image boundary", () => {
  test("resolves absolute, relative and file URL image references inside an allowed root", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-webui-image-"));
    const image = join(root, "preview.png");
    try {
      writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const canonicalImage = realpathSync(image);
      expect(resolveLocalImage(image, { cwd: root, home: root, allowedRoots: [root] })).toMatchObject({ path: canonicalImage, contentType: "image/png", size: 4 });
      expect(resolveLocalImage("./preview.png", { cwd: root, home: root, allowedRoots: [root] }).path).toBe(canonicalImage);
      expect(resolveLocalImage(new URL(`file://${image}`).href, { cwd: root, home: root, allowedRoots: [root] }).path).toBe(canonicalImage);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects paths outside the boundary, symbolic links, non-images and oversized files", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-webui-image-root-"));
    const outside = mkdtempSync(join(tmpdir(), "codex-webui-image-outside-"));
    try {
      const outsideImage = join(outside, "outside.png");
      writeFileSync(outsideImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeFileSync(join(root, "notes.txt"), "not an image");
      writeFileSync(join(root, "large.png"), Buffer.alloc(8));
      symlinkSync(outsideImage, join(root, "linked.png"));

      expect(() => resolveLocalImage(outsideImage, { cwd: root, home: root, allowedRoots: [root] })).toThrow();
      expect(() => resolveLocalImage(join(root, "linked.png"), { cwd: root, home: root, allowedRoots: [root] })).toThrow();
      expect(() => resolveLocalImage(join(root, "notes.txt"), { cwd: root, home: root, allowedRoots: [root] })).toThrow();
      expect(() => resolveLocalImage(join(root, "large.png"), { cwd: root, home: root, allowedRoots: [root], maxBytes: 4 })).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("refuses images stored in credential directories", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-webui-image-home-"));
    try {
      mkdirSync(join(home, ".ssh"));
      mkdirSync(join(home, ".codex"));
      writeFileSync(join(home, ".ssh", "secret.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeFileSync(join(home, ".codex", "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const options = { cwd: home, home, allowedRoots: [home] };

      expect(() => resolveLocalImage(join(home, ".ssh", "secret.png"), options)).toThrow(/not allowed/i);
      expect(() => resolveLocalImage(join(home, ".codex", "shot.png"), options)).toThrow(/not allowed/i);
      expect(() => readVerifiedLocalImage(join(home, ".codex", "shot.png"), options)).toThrow(/not allowed/i);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
