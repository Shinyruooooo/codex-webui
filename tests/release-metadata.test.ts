import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const version = JSON.parse(read("package.json")).version;

describe("release metadata", () => {
  test("keeps the package and app-server health/client versions consistent", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
    expect(read("server.ts").match(/const APP_VERSION = "([^"]+)";/)?.[1]).toBe(version);
  });

  test("includes the current version in the Changelog and release notes", () => {
    const changelog = read("CHANGELOG.md"), notes = read("RELEASE_REPORT.md");
    expect(changelog).toContain("## [Unreleased]");
    expect(changelog).toContain(`## [${version}] - `);
    expect(notes.startsWith(`# Codex PiWeb UI v${version}`)).toBe(true);
    expect(notes).toContain(`**Release tag:** \`v${version}\``);
  });

  test("publishes verified version tags automatically or through manual recovery", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain('tags:\n      - "v*.*.*"');
    expect(workflow).not.toContain("pull_request");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("ref: refs/tags/${{ env.RELEASE_TAG }}");
    expect(workflow).toMatch(/uses: actions\/checkout@[a-f0-9]{40}/);
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("--verify-tag");
    expect(workflow).toContain("--notes-file RELEASE_REPORT.md");
  });
});
