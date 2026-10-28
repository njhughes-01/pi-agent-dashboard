#!/usr/bin/env node
import { spawn } from "node:child_process";
/**
 * Pack a release tree into a deterministic tarball + SHA256SUMS + manifest.json.
 *
 *   node make-artifact.mjs --tree <dir containing pi-agent-dashboard/> --out <dir> --version <v> --source-sha <sha>
 *
 * Determinism: sorted entries, mtime 0, root owner, `gzip -n`. Refuses (and
 * writes nothing) on a missing required file, a symlink outside node_modules/.bin,
 * or a credential-shaped file/token. See change: fork-release-and-local-install.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const layout = JSON.parse(fs.readFileSync(path.join(HERE, "layout-manifest.json"), "utf8"));
/** Token shapes scanned everywhere, including node_modules (no false positives in a real tree). */
const TOKEN_CONTENT = [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, /\bsk-ant-[A-Za-z0-9_-]{20,}/];
/** Also scanned outside node_modules; third-party docs/test fixtures there legitimately contain these shapes. */
const OWN_CONTENT = [/-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/];
/** Larger files are binaries (native toolchains); content scanning would only slow the build. */
const MAX_SCAN_BYTES = 50_000_000;

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, "")] = argv[i + 1];
  for (const r of ["tree", "out", "version", "source-sha"]) if (!a[r]) throw new Error(`--${r} is required`);
  return a;
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    yield [p, e];
    if (e.isDirectory()) yield* walk(p);
  }
}

function audit(tree) {
  const digest = createHash("sha256");
  for (const [p, e] of walk(tree)) {
    const rel = path.relative(tree, p).split(path.sep).join("/");
    const inNm = rel.split("/").includes("node_modules");
    if (e.isSymbolicLink()) {
      if (!/(^|\/)node_modules\/(?:.*\/)?\.bin\//.test(rel)) throw new Error(`symlink outside node_modules/.bin: ${rel}`);
      const target = fs.readlinkSync(p);
      const inside = path.relative(tree, path.resolve(path.dirname(p), target));
      if (path.isAbsolute(target) || inside === ".." || inside.startsWith(`..${path.sep}`)) throw new Error(`symlink escapes the tree: ${rel}`);
      digest.update(`L ${rel} ${target}\0`);
    } else if (e.isFile()) {
      const base = e.name;
      if (layout.forbiddenNames.includes(base)) throw new Error(`forbidden file in tree: ${rel}`);
      const buf = fs.readFileSync(p);
      if (buf.length <= MAX_SCAN_BYTES) {
        const text = buf.toString("latin1");
        for (const re of inNm ? TOKEN_CONTENT : [...TOKEN_CONTENT, ...OWN_CONTENT]) if (re.test(text)) throw new Error(`credential-shaped content in ${rel}`);
      }
      digest.update(`F ${rel} ${createHash("sha256").update(buf).digest("hex")}\0`);
    }
  }
  return digest.digest("hex");
}

function tarGz(parent, outFile) {
  return new Promise((resolve, reject) => {
    const tar = spawn("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "--format=gnu", "-cf", "-", "-C", parent, layout.topDir], { stdio: ["ignore", "pipe", "inherit"] });
    const gz = spawn("gzip", ["-n", "-9"], { stdio: ["pipe", fs.openSync(outFile, "w"), "inherit"] });
    tar.stdout.pipe(gz.stdin);
    let pending = 2;
    const done = (code, who) => {
      if (code !== 0) return reject(new Error(`${who} exited ${code}`));
      if (--pending === 0) resolve();
    };
    tar.on("close", (c) => done(c, "tar"));
    gz.on("close", (c) => done(c, "gzip"));
  });
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const parent = path.resolve(a.tree);
  const tree = path.join(parent, layout.topDir);
  for (const f of layout.requiredFiles) if (!fs.lstatSync(path.join(tree, f), { throwIfNoEntry: false })?.isFile()) throw new Error(`required file missing: ${f}`);
  const treeDigest = audit(tree);
  // --node-major overrides the layout's target (tests build for the runner's own Node).
  const nodeMajor = a["node-major"] === undefined ? layout.nodeMajor : Number(a["node-major"]);
  if (!Number.isInteger(nodeMajor) || nodeMajor <= 0) throw new Error(`--node-major must be a positive integer, got ${a["node-major"]}`);
  const name = `spinx-pi-dashboard-${a.version}-${layout.platform}-node${nodeMajor}.tar.gz`;
  const out = path.resolve(a.out);
  fs.mkdirSync(out, { recursive: true });
  const tmpTar = path.join(out, `.${name}.partial`);
  try {
    await tarGz(parent, tmpTar);
    const sha = createHash("sha256").update(fs.readFileSync(tmpTar)).digest("hex");
    const manifest = { name: "spinx-pi-dashboard", version: a.version, sourceSha: a["source-sha"], platform: layout.platform, nodeMajor, tarball: name, topDir: layout.topDir, requiredFiles: layout.requiredFiles, treeDigest };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    fs.writeFileSync(path.join(out, "manifest.json"), manifestText);
    fs.renameSync(tmpTar, path.join(out, name));
    const mSha = createHash("sha256").update(manifestText).digest("hex");
    fs.writeFileSync(path.join(out, "SHA256SUMS"), `${sha}  ${name}\n${mSha}  manifest.json\n`);
    console.log(JSON.stringify({ tarball: name, sha256: sha }));
  } finally {
    fs.rmSync(tmpTar, { force: true });
  }
}

main().catch((e) => {
  console.error(`[make-artifact] ${e.message}`);
  process.exit(1);
});
