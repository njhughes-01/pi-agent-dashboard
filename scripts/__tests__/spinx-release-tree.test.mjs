/**
 * Release tree builder (scripts/spinx-release/build-release-tree.mjs):
 * stamps a TEMP COPY only, assembles the tree from npm pack output, overlays the
 * six settings-referenced packages as real files. Uses --skip-install so no
 * network/registry is touched. See change: fork-release-and-local-install.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(REPO, "scripts/spinx-release/build-release-tree.mjs");
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "scripts/spinx-release/layout-manifest.json"), "utf8"));
const VERSION = "9.9.9-spinx.1";
const out = fs.mkdtempSync(path.join(os.tmpdir(), "spinx-tree-"));
const status = () => execFileSync("git", ["-C", REPO, "status", "--porcelain"], { encoding: "utf8" });
let before;
let result;
let tree;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    yield [p, e];
    if (e.isDirectory()) yield* walk(p);
  }
}

beforeAll(() => {
  before = status();
  result = spawnSync("node", [SCRIPT, "--repo", REPO, "--out", out, "--version", VERSION, "--skip-install", "--allow-no-dist"], { encoding: "utf8", timeout: 600000 });
  tree = path.join(out, manifest.topDir);
}, 700000);
afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

describe("build-release-tree", () => {
  it("exits 0", () => {
    expect(result.status, result.stderr).toBe(0);
  });

  it("leaves the source checkout unchanged", () => {
    expect(status()).toBe(before);
  });

  it("contains every required file as a regular file", () => {
    for (const f of manifest.requiredFiles) {
      const st = fs.lstatSync(path.join(tree, f));
      expect(st.isFile(), f).toBe(true);
    }
  });

  it("stamps the version into the root and overlaid packages", () => {
    expect(JSON.parse(fs.readFileSync(path.join(tree, "package.json"), "utf8")).version).toBe(VERSION);
    for (const dir of Object.keys(manifest.overlayPackages)) {
      expect(JSON.parse(fs.readFileSync(path.join(tree, "packages", dir, "package.json"), "utf8")).version).toBe(VERSION);
    }
  });

  it("rewrites inter-package specifiers to the stamped version", () => {
    const root = JSON.parse(fs.readFileSync(path.join(tree, "package.json"), "utf8"));
    expect(root.dependencies["@blackbelt-technology/pi-dashboard-server"]).toBe(`^${VERSION}`);
  });

  it("has no symlinks outside node_modules/.bin", () => {
    for (const [p, e] of walk(tree)) {
      if (e.isSymbolicLink()) expect(p.includes(`${path.sep}.bin${path.sep}`), p).toBe(true);
    }
  });
});
