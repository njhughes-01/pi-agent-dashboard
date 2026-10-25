#!/usr/bin/env node
/**
 * Assemble the fork release tree `<out>/pi-agent-dashboard/`.
 *
 * Works on a TEMPORARY COPY of the tracked files: the version is stamped there
 * (package.json versions + scripts/sync-versions.js), every public workspace is
 * `npm pack`ed, the root tarball is extracted as the tree, the six
 * settings-referenced packages are overlaid as real files, and production
 * node_modules are installed from the local tarballs (file: + overrides, so no
 * registry package with an @blackbelt-technology name is ever resolved).
 * The source checkout is never written.
 *
 *   node build-release-tree.mjs --repo <dir> --out <dir> --version <x.y.z-spinx.N>
 *        [--skip-install] [--ignore-scripts] [--allow-no-dist]
 *
 * See change: fork-release-and-local-install.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "layout-manifest.json"), "utf8"));

function parseArgs(argv) {
  const a = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--repo" || k === "--out" || k === "--version") a[k.slice(2)] = argv[++i];
    else if (k.startsWith("--")) a.flags.add(k.slice(2));
    else throw new Error(`unexpected argument ${k}`);
  }
  for (const r of ["repo", "out", "version"]) if (!a[r]) throw new Error(`--${r} is required`);
  if (!/^\d+\.\d+\.\d+-spinx\.\d+$/.test(a.version)) throw new Error("--version must look like 1.2.3-spinx.4");
  return a;
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 28, ...opts });

function copyTracked(repo, dest, allowNoDist) {
  const files = run("git", ["-C", repo, "ls-files", "-z"]).split("\0").filter(Boolean);
  for (const f of files) {
    const src = path.join(repo, f);
    if (!fs.existsSync(src) || fs.lstatSync(src).isSymbolicLink()) continue;
    fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
    fs.copyFileSync(src, path.join(dest, f));
  }
  const dist = path.join(repo, "packages/dist");
  if (fs.existsSync(dist)) fs.cpSync(dist, path.join(dest, "packages/dist"), { recursive: true, dereference: false });
  else if (!allowNoDist) throw new Error("packages/dist is missing: run the web build first (or pass --allow-no-dist)");
}

function listPackageJsons(dir) {
  const out = [path.join(dir, "package.json")];
  for (const e of fs.readdirSync(path.join(dir, "packages"), { withFileTypes: true })) {
    const p = path.join(dir, "packages", e.name, "package.json");
    if (e.isDirectory() && fs.existsSync(p)) out.push(p);
  }
  return out;
}

function stamp(copy, version) {
  for (const p of listPackageJsons(copy)) {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j.version = version;
    fs.writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`);
  }
  run("node", ["scripts/sync-versions.js"], { cwd: copy });
}

function packAll(copy, tarDir) {
  fs.mkdirSync(tarDir, { recursive: true });
  const packed = {};
  for (const p of listPackageJsons(copy)) {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (j.private) continue;
    const lines = run("npm", ["pack", "--ignore-scripts", "--pack-destination", tarDir], { cwd: path.dirname(p) }).trim().split("\n");
    packed[j.name] = path.join(tarDir, lines[lines.length - 1].trim());
  }
  return packed;
}

function extractTarball(tgz, dest, strip = 1) {
  fs.mkdirSync(dest, { recursive: true });
  run("tar", ["-xzf", tgz, "-C", dest, `--strip-components=${strip}`, "--no-same-owner"]);
}

/** Dependencies whose install scripts must run (npm >= 11.18 skips all others unless approved). */
const ALLOW_SCRIPTS = ["esbuild", "koffi", "node-pty", "ffmpeg-static", "@ffprobe-installer/linux-x64", "protobufjs", "@blackbelt-technology/pi-dashboard-server", "@blackbelt-technology/pi-dashboard-forms-bpmn"];

function installDeps(packed, installDir, ignoreScripts) {
  const deps = {};
  for (const [name, tgz] of Object.entries(packed)) if (name !== manifest.rootPackage) deps[name] = `file:${tgz}`;
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(path.join(installDir, "package.json"), JSON.stringify({ name: "spinx-staging", version: "0.0.0", private: true, dependencies: deps, overrides: deps, allowScripts: Object.fromEntries(ALLOW_SCRIPTS.map((n) => [n, true])) }, null, 2));
  const args = ["install", "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false", "--install-links"];
  if (ignoreScripts) args.push("--ignore-scripts");
  run("npm", args, { cwd: installDir, stdio: ["ignore", "inherit", "inherit"] });
  fs.rmSync(path.join(installDir, "node_modules/.package-lock.json"), { force: true });
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const repo = path.resolve(a.repo);
  const out = path.resolve(a.out);
  const tree = path.join(out, manifest.topDir);
  if (fs.existsSync(tree)) throw new Error(`${tree} already exists`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "spinx-build-"));
  try {
    const copy = path.join(work, "src");
    copyTracked(repo, copy, a.flags.has("allow-no-dist"));
    stamp(copy, a.version);
    const packed = packAll(copy, path.join(work, "tarballs"));
    extractTarball(packed[manifest.rootPackage], tree);
    for (const [dir, name] of Object.entries(manifest.overlayPackages)) {
      if (!packed[name]) throw new Error(`workspace package ${name} is not packable`);
      fs.rmSync(path.join(tree, "packages", dir), { recursive: true, force: true });
      extractTarball(packed[name], path.join(tree, "packages", dir));
    }
    if (!a.flags.has("skip-install")) {
      const installDir = path.join(work, "install");
      installDeps(packed, installDir, a.flags.has("ignore-scripts"));
      fs.cpSync(path.join(installDir, "node_modules"), path.join(tree, "node_modules"), { recursive: true, verbatimSymlinks: true });
      if (!a.flags.has("ignore-scripts")) {
        run("node", ["scripts/maybe-patch-package.cjs"], { cwd: tree });
        run("node", ["scripts/fix-pty-permissions.cjs"], { cwd: tree });
      }
    }
    for (const f of manifest.requiredFiles) if (!fs.lstatSync(path.join(tree, f), { throwIfNoEntry: false })?.isFile()) throw new Error(`required file missing from tree: ${f}`);
    console.log(JSON.stringify({ tree, version: a.version, packages: Object.keys(packed).length }));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

try {
  main();
} catch (e) {
  console.error(`[build-release-tree] ${e.message}`);
  process.exit(1);
}
