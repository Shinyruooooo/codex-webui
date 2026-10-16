import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertWritableCodexHome,
  buildSkillMarkdownTemplate,
  defaultSkillExtraRoots,
  deletePersonalSkill,
  installCuratedOfficialSkill,
  isEditablePersonalSkillPath,
  isOfficialCuratedSkillPath,
  listCuratedOfficialSkills,
  normalizeSkillName,
  readSkillFile,
  savePersonalSkill,
} from "../server/skill-service.js";
import { buildConversationInput } from "../public/session-tools.js";

function tempRoot(prefix = "codex-skill-service-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeOfficialFixture(codexHome, id = "playwright") {
  const repo = join(codexHome, "vendor_imports", "skills");
  const curated = join(repo, "skills", ".curated", id);
  mkdirSync(curated, { recursive: true });
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/openai/skills.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n');
  writeFileSync(join(curated, "SKILL.md"), `---\nname: ${id}\ndescription: Browser automation\n---\n# Playwright\n`);
  writeFileSync(join(curated, "helper.txt"), "offline bundle\n");
  writeFileSync(join(curated, "image.bin"), Buffer.from([0, 255, 128, 10, 0, 195]));
  writeFileSync(join(curated, "run.sh"), Buffer.from("#!/bin/sh\necho safe\n"));
  chmodSync(join(curated, "run.sh"), 0o755);
  writeFileSync(join(codexHome, "vendor_imports", "skills-curated-cache.json"), JSON.stringify({
    skills: [{ id, name: id, description: "Browser automation", shortDescription: "Automate browser" }],
  }));
  return curated;
}

const cleanup = (root: string) => rmSync(root, { recursive: true, force: true });

describe("skills management service", () => {
  test("accepts only exact lowercase skill names; traversal is never normalized", () => {
    expect(normalizeSkillName("my-skill-01")).toBe("my-skill-01");
    for (const name of ["My Skill", "my skill", "../name", "a/../b", "---", "", ".system"]) {
      expect(() => normalizeSkillName(name)).toThrow();
    }
  });

  test("creates, reads, updates metadata without replacing the submitted body, and deletes personal skills", () => {
    const root = tempRoot();
    const codexHome = join(root, ".codex");
    const systemDir = join(codexHome, "skills", ".system", "openai-docs");
    mkdirSync(systemDir, { recursive: true });
    const systemSkillPath = join(systemDir, "SKILL.md");
    writeFileSync(systemSkillPath, "---\nname: openai-docs\ndescription: Official docs\n---\n# Official\n");
    try {
      expect(isEditablePersonalSkillPath(systemSkillPath, codexHome)).toBe(false);
      expect(readSkillFile(systemSkillPath, { codexHome, homeDir: root }).editable).toBe(false);
      const created = savePersonalSkill({
        name: "my-lab-skill", description: "Lab workflow skill", instructions: "# Distinct body\nDo the work.", codexHome,
      });
      expect(created.editable).toBe(true);
      expect(created.content).toContain("name: my-lab-skill");
      expect(isEditablePersonalSkillPath(created.path, codexHome)).toBe(true);
      expect(() => savePersonalSkill({ name: "../my-lab-skill", codexHome })).toThrow();
      expect(() => savePersonalSkill({ name: "my-lab-skill", description: "duplicate", codexHome })).toThrow(/already exists/i);

      const text = "---\nname: my-lab-skill\ndescription: Original\ncustom: [one, two]\n---\n# Keep exactly this body\n\nDo not regenerate.\n";
      const updated = savePersonalSkill({ name: "my-lab-skill", content: text, description: "Updated metadata", overwrite: true, codexHome });
      const metadata = Bun.YAML.parse(updated.content.match(/^---\n([\s\S]*?)\n---/)![1]);
      expect(metadata.description).toBe('Updated metadata');
      expect(metadata.custom).toEqual(['one', 'two']);
      expect(updated.content.endsWith("# Keep exactly this body\n\nDo not regenerate.\n")).toBe(true);
      expect(updated.content).not.toContain("Step 1:");
      expect(() => deletePersonalSkill({ path: systemSkillPath, codexHome })).toThrow(/Only personal skills/i);
      expect(deletePersonalSkill({ name: "my-lab-skill", codexHome }).deleted).toBe("my-lab-skill");
      expect(existsSync(created.path)).toBe(false);
    } finally { cleanup(root); }
  });

  test("rejects invalid YAML, invalid fields, and frontmatter/name mismatch without altering an existing skill", () => {
    const root = tempRoot();
    const codexHome = join(root, ".codex");
    try {
      const original = savePersonalSkill({ name: "safe-skill", description: "Valid", instructions: "# original", codexHome });
      for (const content of [
        "---\nname: safe-skill\ndescription: [broken\n---\nbody\n",
        "---\nname: ../safe-skill\ndescription: no\n---\nbody\n",
        "---\nname: other-skill\ndescription: no\n---\nbody\n",
        "---\nname: safe-skill\ndescription: 42\n---\nbody\n",
        "---\nname: safe-skill\n---\nbody\n",
      ]) {
        expect(() => savePersonalSkill({ name: "safe-skill", content, overwrite: true, codexHome })).toThrow();
      }
      expect(readSkillFile(original.path, { codexHome, homeDir: root }).content).toContain("# original");
    } finally { cleanup(root); }
  });

  test("allows reads of system and explicit external roots but never writes there", () => {
    const root = tempRoot();
    const codexHome = join(root, ".codex");
    const systemDir = join(codexHome, "skills", ".system", "system-skill");
    const external = join(root, "project", "skills", "external-skill");
    mkdirSync(systemDir, { recursive: true });
    mkdirSync(external, { recursive: true });
    const systemFile = join(systemDir, "SKILL.md");
    const externalFile = join(external, "SKILL.md");
    const text = "---\nname: read-only\ndescription: Read only\n---\n# Body\n";
    writeFileSync(systemFile, text);
    writeFileSync(externalFile, text);
    try {
      expect(readSkillFile(systemFile, { codexHome, homeDir: root }).editable).toBe(false);
      expect(readSkillFile(externalFile, { codexHome, homeDir: root, extraRoots: [join(root, "project", "skills")] }).content).toContain("# Body");
      expect(() => deletePersonalSkill({ path: externalFile, codexHome })).toThrow();
    } finally { cleanup(root); }
  });

  test("rejects symlinked personal roots including mocked ~/.pi destinations and dangling links", () => {
    const root = tempRoot();
    const piSkills = join(root, ".pi", "agent", "skills");
    const codexHome = join(root, ".codex");
    mkdirSync(join(piSkills, "victim"), { recursive: true });
    const protectedFile = join(piSkills, "victim", "SKILL.md");
    writeFileSync(protectedFile, "must survive\n");
    mkdirSync(codexHome, { recursive: true });
    symlinkSync(piSkills, join(codexHome, "skills"));
    try {
      expect(() => savePersonalSkill({ name: "nope", codexHome })).toThrow(/symbolic|directory|symlink/i);
      expect(() => deletePersonalSkill({ name: "victim", codexHome })).toThrow(/symbolic|directory|symlink/i);
      expect(readFileSync(protectedFile, "utf8")).toBe("must survive\n");
      const normalHome = join(root, "other-codex");
      const skills = join(normalHome, "skills");
      mkdirSync(skills, { recursive: true });
      symlinkSync(join(root, "missing-target"), join(skills, "dangling"));
      expect(() => savePersonalSkill({ name: "dangling", content: buildSkillMarkdownTemplate({ name: "dangling", description: "valid" }), codexHome: normalHome })).toThrow();

      const realHome = join(root, "real-codex");
      mkdirSync(realHome);
      const linkedHome = join(root, "linked-codex");
      symlinkSync(realHome, linkedHome);
      expect(() => savePersonalSkill({ name: "through-link", codexHome: linkedHome })).toThrow(/symbolic|link/i);
      expect(existsSync(join(realHome, "skills"))).toBe(false);
    } finally { cleanup(root); }
  });

  test("does not recurse into a replacement directory swapped between stat and open", () => {
    const root = tempRoot();
    const codexHome = join(root, '.codex');
    const skillDir = join(codexHome, 'skills', 'victim');
    savePersonalSkill({ name: 'victim', description: 'Original skill', codexHome });
    const realOpen = fs.openSync;
    let opens = 0;
    const hook = spyOn(fs, 'openSync').mockImplementation((path: any, ...args: any[]) => {
      if (/^\/proc\/self\/fd\/\d+\/victim$/.test(String(path)) && ++opens === 3) {
        fs.renameSync(skillDir, join(root, 'original-skill'));
        mkdirSync(skillDir);
        writeFileSync(join(skillDir, 'sentinel.txt'), 'replacement must survive');
      }
      return (realOpen as any)(path, ...args);
    });
    try {
      expect(() => deletePersonalSkill({ name: 'victim', codexHome })).toThrow(/changed/i);
      expect(opens).toBe(3);
      expect(readFileSync(join(skillDir, 'sentinel.txt'), 'utf8')).toBe('replacement must survive');
      expect(readFileSync(join(root, 'original-skill', 'SKILL.md'), 'utf8')).toContain('Original skill');
    } finally { hook.mockRestore(); cleanup(root); }
  });

  test("guards CODEX_HOME config destinations and excludes skills beneath a mock ~/.pi from editability", () => {
    const root = tempRoot();
    const mockHome = join(root, "home");
    const piSkill = join(mockHome, ".pi", "skills", "mock-skill");
    mkdirSync(piSkill, { recursive: true });
    const skillFile = join(piSkill, "SKILL.md");
    writeFileSync(skillFile, buildSkillMarkdownTemplate({ name: "mock-skill", description: "mock" }));
    try {
      expect(() => assertWritableCodexHome(join(mockHome, ".pi", "codex"), mockHome)).toThrow(/protected ~\/\.pi/i);
      expect(isEditablePersonalSkillPath(skillFile, join(mockHome, ".pi"), mockHome)).toBe(false);
      const configHome = join(root, "config-home");
      mkdirSync(configHome);
      symlinkSync(join(root, "missing-config"), join(configHome, "config.toml"));
      expect(() => assertWritableCodexHome(configHome, mockHome)).toThrow(/config.toml/i);
      rmSync(join(configHome, 'config.toml'));
      const protectedConfig = join(mockHome, '.pi', 'config.toml');
      writeFileSync(protectedConfig, 'must survive\n');
      linkSync(protectedConfig, join(configHome, 'config.toml'));
      expect(() => assertWritableCodexHome(configHome, mockHome)).toThrow(/hard link/i);
      const actualHome = join(root, "actual-home");
      mkdirSync(actualHome);
      symlinkSync(actualHome, join(root, "linked-home"));
      expect(() => assertWritableCodexHome(join(root, "linked-home"), mockHome)).toThrow(/symbolic/i);
    } finally { cleanup(root); }
  });

  test("does not discover ~/.pi implicitly; only configured roots are returned", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".pi", "agent", "skills"), { recursive: true });
    const configured = join(root, "shared", "skills");
    mkdirSync(configured, { recursive: true });
    try {
      expect(defaultSkillExtraRoots(root)).toEqual([]);
      expect(defaultSkillExtraRoots(root, `~/.pi/agent/skills,${configured}`)).toEqual([join(root, ".pi", "agent", "skills"), configured]);
      const inputs = buildConversationInput({ text: "Run VASP calculation", mentions: [{ type: "skill", name: "dft-vasp", path: "/home/user/.pi/agent/skills/dft-vasp/SKILL.md" }] });
      expect(inputs).toEqual([{ type: "text", text: "Run VASP calculation" }, { type: "skill", name: "dft-vasp", path: "/home/user/.pi/agent/skills/dft-vasp/SKILL.md" }]);
    } finally { cleanup(root); }
  });

  test("curated install requires the local OpenAI-origin hint and preserves bundle bytes and execute bits", () => {
    const root = tempRoot("codex-curated-skills-");
    const codexHome = join(root, ".codex");
    const source = writeOfficialFixture(codexHome);
    try {
      expect(listCuratedOfficialSkills({ codexHome, installedSkills: [{ name: "playwright" }] })).toMatchObject([
        { id: "playwright", availableLocal: true, installed: false },
      ]);
      const installed = installCuratedOfficialSkill({ id: "playwright", codexHome });
      expect(existsSync(installed.path)).toBe(true);
      expect(readFileSync(join(source, "image.bin"))).toEqual(readFileSync(join(codexHome, "skills", "playwright", "image.bin")));
      expect(readFileSync(join(source, "run.sh"))).toEqual(readFileSync(join(codexHome, "skills", "playwright", "run.sh")));
      expect(statSync(join(codexHome, "skills", "playwright", "run.sh")).mode & 0o111).toBe(0o111);
      expect(isOfficialCuratedSkillPath(installed.path, codexHome)).toBe(true);
      expect(listCuratedOfficialSkills({ codexHome })[0].installed).toBe(true);
      expect(() => installCuratedOfficialSkill({ id: "../playwright", codexHome })).toThrow();

      const untrusted = join(root, "untrusted", "vendor_imports", "skills");
      const untrustedHome = join(root, "untrusted");
      const bad = join(untrusted, "skills", ".curated", "other");
      mkdirSync(bad, { recursive: true });
      writeFileSync(join(bad, "SKILL.md"), "---\nname: other\ndescription: x\n---\nx\n");
      expect(() => installCuratedOfficialSkill({ id: "other", codexHome: untrustedHome })).toThrow(/local skills cache/i);
      expect(existsSync(join(untrustedHome, "skills", "other"))).toBe(false);
    } finally { cleanup(root); }
  });

  test("rejects an entire curated bundle containing symlinks, hardlinks, or special entries", () => {
    const root = tempRoot("codex-curated-security-");
    const codexHome = join(root, ".codex");
    try {
      const source = writeOfficialFixture(codexHome);
      const nested = join(source, "nested");
      mkdirSync(nested);
      symlinkSync(join(source, "SKILL.md"), join(nested, "linked.txt"));
      expect(() => installCuratedOfficialSkill({ id: "playwright", codexHome })).toThrow(/not available|symbolic/i);
      expect(existsSync(join(codexHome, "skills", "playwright"))).toBe(false);
      rmSync(join(nested, "linked.txt"));
      linkSync(join(source, "helper.txt"), join(nested, "hardlinked.txt"));
      expect(() => installCuratedOfficialSkill({ id: "playwright", codexHome })).toThrow(/not available|hard-linked/i);
      expect(existsSync(join(codexHome, "skills", "playwright"))).toBe(false);
      rmSync(join(nested, "hardlinked.txt"));
      execFileSync("mkfifo", [join(nested, "pipe")]);
      expect(() => installCuratedOfficialSkill({ id: "playwright", codexHome })).toThrow(/not available|special/i);
      expect(existsSync(join(codexHome, "skills", "playwright"))).toBe(false);
    } finally { cleanup(root); }
  });

  test("uses descriptor-verified bounded reads and refuses hard-link replacement", () => {
    const root = tempRoot();
    const codexHome = join(root, ".codex");
    const dir = join(codexHome, "skills", "bounded");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    try {
      writeFileSync(path, "x".repeat(512 * 1024 + 1));
      expect(() => readSkillFile(path, { codexHome, homeDir: root })).toThrow(/too large/i);
      writeFileSync(path, "---\nname: bounded\ndescription: Valid\n---\nbody\n");
      const second = join(root, "outside-hardlink.md");
      linkSync(path, second);
      expect(() => savePersonalSkill({ name: "bounded", content: buildSkillMarkdownTemplate({ name: "bounded", description: "new" }), overwrite: true, codexHome })).toThrow(/hard-linked/i);
      expect(readSkillFile(path, { codexHome, homeDir: root }).content).toContain("description: Valid");
    } finally { cleanup(root); }
  });
});
