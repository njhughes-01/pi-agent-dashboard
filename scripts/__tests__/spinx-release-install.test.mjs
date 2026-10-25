/**
 * install-release.sh + rollback-release.sh against a TEMP global dir with a
 * fake systemctl and a fake health endpoint — the live install is never read
 * or written. See change: fork-release-and-local-install.
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
const NEW = "1.2.3-spinx.1";
const OLD = "0.9.0";

const tmps = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "spinx-inst-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// The health endpoint lives in a child process: spawnSync blocks this one's event loop.
const DOWN_FLAG = path.join(os.tmpdir(), `spinx-health-down-${process.pid}`);
let server;
let port;
const setHealthy = (v) => (v ? fs.rmSync(DOWN_FLAG, { force: true }) : fs.writeFileSync(DOWN_FLAG, ""));
beforeAll(async () => {
  server = spawn("node", ["-e", `const h=require("http"),f=require("fs");h.createServer((q,r)=>{const d=f.existsSync(${JSON.stringify(DOWN_FLAG)});r.statusCode=d?503:200;r.end(d?"down":'{"status":"ok"}')}).listen(0,"127.0.0.1",function(){console.log(this.address().port)})`], { stdio: ["ignore", "pipe", "inherit"] });
  port = await new Promise((resolve) => server.stdout.once("data", (d) => resolve(Number(String(d).trim()))));
});
afterAll(() => {
  server.kill();
  setHealthy(true);
});

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function env() {
  const root = tmp();
  const globalDir = path.join(root, "global");
  const backup = path.join(root, "backup");
  const calls = path.join(root, "systemctl.log");
  const fakeCtl = path.join(root, "fake-systemctl");
  write(fakeCtl, `#!/usr/bin/env bash\necho "$@" >> "${calls}"\n`);
  fs.chmodSync(fakeCtl, 0o755);
  // current "0.9.0" install
  const cur = path.join(globalDir, "pi-agent-dashboard");
  write(path.join(cur, "package.json"), JSON.stringify({ version: OLD }));
  write(path.join(cur, "packages/old.txt"), "old");
  write(path.join(cur, "node_modules/dep/index.js"), "dep");
  // artifact
  const treeParent = path.join(root, "tree");
  const tree = path.join(treeParent, layout.topDir);
  for (const f of layout.requiredFiles) write(path.join(tree, f), f === "package.json" ? JSON.stringify({ version: NEW }) : `// ${f}\n`);
  const art = path.join(root, "art");
  const r = spawnSync("node", [path.join(DIR, "make-artifact.mjs"), "--tree", treeParent, "--out", art, "--version", NEW, "--source-sha", "deadbeef"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  const base = {
    ...process.env,
    SPINX_GLOBAL_DIR: globalDir,
    SPINX_BACKUP_DIR: backup,
    SPINX_SYSTEMCTL: fakeCtl,
    SPINX_HEALTH_URL: `http://127.0.0.1:${port}/api/health`,
    SPINX_HEALTH_TIMEOUT: "3",
  };
  const tarball = fs.readdirSync(art).find((f) => f.endsWith(".tar.gz"));
  const args = ["--artifact", path.join(art, tarball), "--sums", path.join(art, "SHA256SUMS"), "--manifest", path.join(art, "manifest.json")];
  return { root, globalDir, backup, calls, cur, art, tarball, args, base };
}

const install = (e, extra = [], extraEnv = {}) => spawnSync("bash", [path.join(DIR, "install-release.sh"), ...e.args, ...extra], { encoding: "utf8", env: { ...e.base, ...extraEnv } });
const rollback = (e) => spawnSync("bash", [path.join(DIR, "rollback-release.sh")], { encoding: "utf8", env: e.base });
const treeHash = (dir) => spawnSync("bash", ["-c", `. "${DIR}/lib.sh"; tree_hash "${dir}"`], { encoding: "utf8" }).stdout.trim();
const ver = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
const callLog = (e) => (fs.existsSync(e.calls) ? fs.readFileSync(e.calls, "utf8").trim().split("\n") : []);
const leftovers = (e) => fs.readdirSync(e.globalDir).filter((n) => n.startsWith(".pi-agent-dashboard.next-"));

describe("install-release.sh", () => {
  it("installs, keeps the old tree as the rollback dir and records state", () => {
    setHealthy(true);
    const e = env();
    const before = treeHash(e.cur);
    const r = install(e);
    expect(r.status, r.stderr).toBe(0);
    expect(ver(e.cur)).toBe(NEW);
    const state = JSON.parse(fs.readFileSync(path.join(e.backup, "last-install.json"), "utf8"));
    expect(state.oldVersion).toBe(OLD);
    expect(treeHash(state.rollbackDir)).toBe(before);
    expect(fs.existsSync(`${state.backup}.sha256`)).toBe(true);
    expect(callLog(e)).toEqual(["--user stop pi-dashboard.service", "--user start pi-dashboard.service"]);
    expect(leftovers(e)).toEqual([]);
  });

  it("refuses a checksum mismatch before touching the service or the install", () => {
    const e = env();
    const before = treeHash(e.cur);
    fs.appendFileSync(path.join(e.art, e.tarball), "tamper");
    const r = install(e);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("checksum mismatch");
    expect(treeHash(e.cur)).toBe(before);
    expect(callLog(e)).toEqual([]);
    expect(leftovers(e)).toEqual([]);
  });

  it("--dry-run changes nothing", () => {
    const e = env();
    const before = treeHash(e.cur);
    const r = install(e, ["--dry-run"]);
    expect(r.status, r.stderr).toBe(0);
    expect(treeHash(e.cur)).toBe(before);
    expect(callLog(e)).toEqual([]);
    expect(leftovers(e)).toEqual([]);
  });

  it("rolls back automatically when the health check fails", () => {
    setHealthy(false);
    const e = env();
    const before = treeHash(e.cur);
    const r = install(e);
    setHealthy(true);
    expect(r.status).not.toBe(0);
    expect(treeHash(e.cur)).toBe(before);
    expect(callLog(e)).toEqual(["--user stop pi-dashboard.service", "--user start pi-dashboard.service", "--user stop pi-dashboard.service", "--user start pi-dashboard.service"]);
  });

  it("restores the old tree when it fails right after the first rename", () => {
    setHealthy(true);
    const e = env();
    const before = treeHash(e.cur);
    const r = install(e, [], { SPINX_TEST_FAIL_AFTER_FIRST_RENAME: "1" });
    expect(r.status).not.toBe(0);
    expect(treeHash(e.cur)).toBe(before);
    expect(leftovers(e)).toEqual([]);
  });

  it("restores the old tree when writing the install record fails", () => {
    setHealthy(true);
    const e = env();
    const before = treeHash(e.cur);
    fs.mkdirSync(path.join(e.backup, "last-install.json.tmp"), { recursive: true });
    const r = install(e);
    expect(r.status).not.toBe(0);
    expect(treeHash(e.cur)).toBe(before);
    expect(callLog(e).at(-1)).toBe("--user start pi-dashboard.service");
  });

  it("restarts the old service when the first rename cannot happen", () => {
    setHealthy(true);
    const e = env();
    const before = treeHash(e.cur);
    fs.chmodSync(e.globalDir, 0o555); // renames inside it now fail
    const r = install(e);
    fs.chmodSync(e.globalDir, 0o755);
    expect(r.status).not.toBe(0);
    expect(treeHash(e.cur)).toBe(before);
  });

  it("refuses to run while another install/rollback holds the lock", () => {
    setHealthy(true);
    const e = env();
    fs.mkdirSync(e.backup, { recursive: true });
    const holder = spawn("bash", ["-c", `exec 9>"${path.join(e.backup, ".lock")}"; flock 9; echo held; sleep 20`], { stdio: ["ignore", "pipe", "inherit"] });
    return new Promise((resolve) => {
      holder.stdout.once("data", () => {
        const r = install(e);
        holder.kill();
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain("another install/rollback is running");
        expect(callLog(e)).toEqual([]);
        resolve();
      });
    });
  });

  it("never writes outside the global dir and the backup dir", () => {
    setHealthy(true);
    const e = env();
    expect(install(e).status).toBe(0);
    expect(fs.readdirSync(e.root).sort()).toEqual(["art", "backup", "fake-systemctl", "global", "systemctl.log", "tree"]);
  });
});

describe("rollback-release.sh", () => {
  it("round trip: install then rollback restores a hash-identical tree", () => {
    setHealthy(true);
    const e = env();
    const before = treeHash(e.cur);
    expect(install(e).status).toBe(0);
    expect(treeHash(e.cur)).not.toBe(before);
    const r = rollback(e);
    expect(r.status, r.stderr).toBe(0);
    expect(treeHash(e.cur)).toBe(before);
    expect(ver(e.cur)).toBe(OLD);
  });

  it("keeps the active install when the rollback cannot complete", () => {
    setHealthy(true);
    const e = env();
    expect(install(e).status).toBe(0);
    const installed = treeHash(e.cur);
    const state = JSON.parse(fs.readFileSync(path.join(e.backup, "last-install.json"), "utf8"));
    fs.chmodSync(e.globalDir, 0o555);
    const r = rollback(e);
    fs.chmodSync(e.globalDir, 0o755);
    expect(r.status).not.toBe(0);
    expect(treeHash(e.cur)).toBe(installed);
    expect(fs.existsSync(state.rollbackDir)).toBe(true);
  });

  it("refuses when there is no install record", () => {
    const e = env();
    expect(rollback(e).status).not.toBe(0);
  });
});
