/**
 * Layout manifest of the fork release artifact. The required files are exactly
 * the paths ~/.pi/agent/settings.json loads the bridge + five plugins from.
 * See change: fork-release-and-local-install.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "scripts/spinx-release/layout-manifest.json"), "utf8"));

describe("spinx release layout manifest", () => {
  it("requires the bin and the extension bridge", () => {
    expect(manifest.requiredFiles).toContain("packages/server/bin/pi-dashboard.mjs");
    expect(manifest.requiredFiles).toContain("packages/extension/package.json");
  });

  it("requires all five configured plugin bridges", () => {
    for (const d of ["automation-plugin", "flows-plugin", "goal-plugin", "gmail-plugin", "flows-anthropic-bridge-plugin"]) {
      expect(manifest.requiredFiles).toContain(`packages/${d}/src/bridge/index.ts`);
    }
  });

  it("maps every overlay dir to a real workspace package with the declared name", () => {
    for (const [dir, name] of Object.entries(manifest.overlayPackages)) {
      const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "packages", dir, "package.json"), "utf8"));
      expect(pkg.name).toBe(name);
    }
  });

  it("every required packages/ file exists in the source workspace (or its server bin)", () => {
    for (const f of manifest.requiredFiles.filter((x) => x.startsWith("packages/"))) {
      expect(fs.existsSync(path.join(REPO, f)), f).toBe(true);
    }
  });
});

describe("spinx-release workflow", () => {
  const code = fs
    .readFileSync(path.join(REPO, ".github/workflows/spinx-release.yml"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

  it("triggers only on spinx-v* tags and manual dispatch", () => {
    expect(code).toContain('tags: ["spinx-v*"]');
    expect(code).not.toMatch(/pull_request|branches:/);
  });

  it("never publishes to npm, deploys, restarts services or reads secrets", () => {
    expect(code).not.toMatch(/npm publish|pnpm publish|systemctl|secrets\./);
  });

  it("only the release job has write permissions", () => {
    const [head, ...jobs] = code.split(/^ {2}release:/m);
    expect(jobs).toHaveLength(1);
    expect(head).not.toMatch(/contents: write|id-token: write/);
  });
});
