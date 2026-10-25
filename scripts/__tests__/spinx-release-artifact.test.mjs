/**
 * Artifact packer (scripts/spinx-release/make-artifact.mjs): deterministic
 * tarball, SHA256SUMS, manifest.json, secrets scan.
 * See change: fork-release-and-local-install.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(REPO, "scripts/spinx-release/make-artifact.mjs");
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "scripts/spinx-release/layout-manifest.json"), "utf8"));
const VERSION = "1.2.3-spinx.1";
const dirs = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "spinx-art-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fakeTree(extra = {}) {
  const parent = tmp();
  const tree = path.join(parent, manifest.topDir);
  for (const f of manifest.requiredFiles) {
    fs.mkdirSync(path.dirname(path.join(tree, f)), { recursive: true });
    fs.writeFileSync(path.join(tree, f), f === "package.json" ? JSON.stringify({ version: VERSION }) : `// ${f}\n`);
  }
  fs.mkdirSync(path.join(tree, "node_modules/.bin"), { recursive: true });
  fs.writeFileSync(path.join(tree, "node_modules/x.js"), "x");
  fs.symlinkSync("../x.js", path.join(tree, "node_modules/.bin/x"));
  for (const [f, c] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(tree, f)), { recursive: true });
    fs.writeFileSync(path.join(tree, f), c);
  }
  return parent;
}
const pack = (parent, out, mtime) => {
  if (mtime) for (const f of manifest.requiredFiles) fs.utimesSync(path.join(parent, manifest.topDir, f), mtime, mtime);
  return spawnSync("node", [SCRIPT, "--tree", parent, "--out", out, "--version", VERSION, "--source-sha", "abc123"], { encoding: "utf8" });
};
const sha = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const NAME = `spinx-pi-dashboard-${VERSION}-linux-x64-node24.tar.gz`;

describe("make-artifact", () => {
  it("writes the tarball, SHA256SUMS and manifest.json", () => {
    const out = tmp();
    const r = pack(fakeTree(), out);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readdirSync(out).sort()).toEqual(["SHA256SUMS", "manifest.json", NAME].sort());
    const sums = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8");
    expect(sums).toContain(`${sha(path.join(out, NAME))}  ${NAME}`);
    const m = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    expect(m).toMatchObject({ version: VERSION, sourceSha: "abc123", platform: "linux-x64", nodeMajor: 24, tarball: NAME });
    expect(m.requiredFiles).toEqual(manifest.requiredFiles);
  });

  it("is reproducible: same tree, different mtimes, identical tarball hash", () => {
    const parent = fakeTree();
    const a = tmp();
    const b = tmp();
    expect(pack(parent, a, new Date(1_000_000_000_000)).status).toBe(0);
    expect(pack(parent, b, new Date(1_700_000_000_000)).status).toBe(0);
    expect(sha(path.join(a, NAME))).toBe(sha(path.join(b, NAME)));
    expect(fs.readFileSync(path.join(a, "manifest.json"), "utf8")).toBe(fs.readFileSync(path.join(b, "manifest.json"), "utf8"));
  });

  it("fails the secrets scan on a planted credential file or token", () => {
    for (const extra of [{ "packages/server/auth.json": "{}" }, { ".env": "A=1" }, { "packages/x/leak.txt": "-----BEGIN OPENSSH PRIVATE KEY-----" }, { "packages/x/t.txt": `ghp_${"a".repeat(36)}` }]) {
      const out = tmp();
      const r = pack(fakeTree(extra), out);
      expect(r.status, JSON.stringify(extra)).not.toBe(0);
      expect(fs.readdirSync(out)).toEqual([]);
    }
  });

  it("scans node_modules too: credential files and tokens fail the pack", () => {
    for (const extra of [{ "node_modules/pkg/.env": "A=1" }, { "node_modules/pkg/id_rsa": "x" }, { "node_modules/pkg/t.js": `sk-ant-${"a".repeat(30)}` }]) {
      expect(pack(fakeTree(extra), tmp()).status, JSON.stringify(extra)).not.toBe(0);
    }
  });

  it("rejects a .bin symlink that escapes into a sibling of the tree", () => {
    const parent = fakeTree();
    fs.mkdirSync(path.join(parent, `${manifest.topDir}-other`));
    fs.symlinkSync("../../../pi-agent-dashboard-other", path.join(parent, manifest.topDir, "node_modules/.bin/escape"));
    expect(pack(parent, tmp()).status).not.toBe(0);
  });

  it("fails when a required file is missing", () => {
    const parent = fakeTree();
    fs.rmSync(path.join(parent, manifest.topDir, manifest.requiredFiles[2]));
    expect(pack(parent, tmp()).status).not.toBe(0);
  });

  it("refuses a symlink outside node_modules/.bin", () => {
    const parent = fakeTree();
    fs.symlinkSync("package.json", path.join(parent, manifest.topDir, "link"));
    expect(pack(parent, tmp()).status).not.toBe(0);
  });
});
