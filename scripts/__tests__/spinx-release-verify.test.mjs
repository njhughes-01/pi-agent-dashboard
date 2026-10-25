/**
 * verify-install.sh against a temp global dir and a throwaway health server;
 * the live install and the real settings.json are never read.
 * See change: fork-release-and-local-install.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(REPO, "scripts/spinx-release");
const layout = JSON.parse(fs.readFileSync(path.join(DIR, "layout-manifest.json"), "utf8"));
const tmps = [];
let server;
let port;

beforeAll(async () => {
  server = spawn("node", ["-e", 'require("http").createServer((q,r)=>{r.end(q.url==="/api/health"?\'{"status":"ok"}\':"<!doctype html><html></html>")}).listen(0,"127.0.0.1",function(){console.log(this.address().port)})'], { stdio: ["ignore", "pipe", "inherit"] });
  port = await new Promise((resolve) => server.stdout.once("data", (d) => resolve(Number(String(d).trim()))));
});
afterAll(() => server.kill());
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function install(version, { omit } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spinx-ver-"));
  tmps.push(root);
  const globalDir = path.join(root, "global");
  const pkg = path.join(globalDir, "pi-agent-dashboard");
  for (const f of layout.requiredFiles) {
    if (f === omit) continue;
    fs.mkdirSync(path.dirname(path.join(pkg, f)), { recursive: true });
    fs.writeFileSync(path.join(pkg, f), f === "package.json" ? JSON.stringify({ version }) : "x");
  }
  const settings = path.join(root, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ packages: [path.join(pkg, "packages/extension"), "npm:something"], dashboardPluginBridges: { goal: path.join(pkg, "packages/goal-plugin/src/bridge/index.ts") } }));
  return { globalDir, settings };
}

const verify = ({ globalDir, settings }, extra = []) =>
  spawnSync("bash", [path.join(DIR, "verify-install.sh"), ...extra], { encoding: "utf8", env: { ...process.env, SPINX_GLOBAL_DIR: globalDir, SPINX_SETTINGS: settings, SPINX_HEALTH_URL: `http://127.0.0.1:${port}/api/health` } });

describe("verify-install.sh", () => {
  it("passes for a complete install and checks settings paths", () => {
    const r = verify(install("1.2.3-spinx.1"), ["--version", "1.2.3-spinx.1"]);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toContain("PASS settings path");
  });

  it("fails when a required plugin bridge is missing", () => {
    const r = verify(install("1.2.3-spinx.1", { omit: "packages/goal-plugin/src/bridge/index.ts" }));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL required file packages/goal-plugin/src/bridge/index.ts");
  });

  it("fails (not silently passes) when settings.json is unreadable JSON", () => {
    const i = install("1.2.3-spinx.1");
    fs.writeFileSync(i.settings, "{ not json");
    const r = verify(i);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL read settings");
  });

  it("fails when health is not a JSON object", () => {
    const i = install("1.2.3-spinx.1");
    const r = spawnSync("bash", [path.join(DIR, "verify-install.sh")], { encoding: "utf8", env: { ...process.env, SPINX_GLOBAL_DIR: i.globalDir, SPINX_SETTINGS: i.settings, SPINX_HEALTH_URL: `http://127.0.0.1:${port}/` } });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL health answers a JSON object");
  });

  it("fails on a version mismatch", () => {
    expect(verify(install("1.0.0-spinx.1"), ["--version", "9.9.9-spinx.9"]).status).toBe(1);
  });
});
