import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

/** Pinned versions from version files: [{ source, file, line, spec }] */
export function versionFiles(dir, pkg) {
  const out = [];
  for (const f of ['.nvmrc', '.node-version']) { const t = read(join(dir, f)); if (t != null) { const line = t.split(/\r?\n/).findIndex((l) => l.trim() && !l.trim().startsWith('#')); if (line !== -1) out.push({ source: f, file: f, line: line + 1, spec: t.split(/\r?\n/)[line].trim() }); } }
  const tv = read(join(dir, '.tool-versions'));
  if (tv) tv.split(/\r?\n/).forEach((l, i) => { const m = /^\s*(nodejs|node)\s+(\S+)/.exec(l); if (m) out.push({ source: '.tool-versions', file: '.tool-versions', line: i + 1, spec: m[2] }); });
  if (pkg?.volta?.node) out.push({ source: 'volta', file: 'package.json', spec: String(pkg.volta.node) });
  for (const f of ['Dockerfile', ...(() => { try { return readdirSync(dir).filter((x) => /^Dockerfile\.|\.Dockerfile$/.test(x)); } catch { return []; } })()]) {
    const t = read(join(dir, f)); if (!t) continue;
    t.split(/\r?\n/).forEach((l, i) => { const m = /^\s*FROM\s+(?:--platform=\S+\s+)?(?:docker\.io\/)?(?:library\/)?node:(\d+(?:\.\d+){0,2})/i.exec(l); if (m) out.push({ source: 'Dockerfile', file: f, line: i + 1, spec: m[1] }); });
  }
  return out;
}

function parseList(v) {
  const s = v.trim();
  if (s.startsWith('[')) return s.replace(/^\[|\].*$/g, '').split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return [s.replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '')];
}

/** Node versions used by GitHub Actions setup-node steps: [{ file, line, spec, via }] */
export function workflowVersions(dir) {
  const wfDir = join(dir, '.github', 'workflows'); const out = [];
  let files = []; try { files = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)); } catch { return out; }
  for (const f of files) {
    const rel = `.github/workflows/${f}`; const text = read(join(wfDir, f)) || ''; const lines = text.split(/\r?\n/);
    // collect matrix lists per key (whole file; good enough for typical workflows)
    const matrix = {};
    lines.forEach((l, i) => {
      const flow = /^\s*matrix:\s*\{(.*)\}\s*$/.exec(l);
      if (flow) for (const m of flow[1].matchAll(/([\w-]+)\s*:\s*(\[[^\]]*\]|[^,}]+)/g)) (matrix[m[1]] ||= []).push(...parseList(m[2]).map((spec) => ({ spec, line: i + 1 })));
      const kv = /^(\s*)([\w-]+):\s*(\[.*\])\s*(#.*)?$/.exec(l);
      if (kv && /node/i.test(kv[2])) (matrix[kv[2]] ||= []).push(...parseList(kv[3]).map((spec) => ({ spec, line: i + 1 })));
      const block = /^(\s*)([\w-]+):\s*$/.exec(l);
      if (block && /node/i.test(block[2])) { for (let j = i + 1; j < lines.length; j++) { const m = /^(\s*)-\s*(.+?)\s*$/.exec(lines[j]); if (!m || m[1].length <= block[1].length) break; (matrix[block[2]] ||= []).push({ spec: m[2].replace(/^['"]|['"]$/g, ''), line: j + 1 }); } }
      const inc = /^\s*-?\s*([\w-]*node[\w-]*):\s*['"]?([\w.*/]+)['"]?\s*$/i.exec(l);
      if (inc && /^\s*-\s/.test(lines[i]) && !/node-version-file/.test(l)) (matrix[inc[1]] ||= []).push({ spec: inc[2], line: i + 1 });
    });
    lines.forEach((l, i) => {
      const m = /^\s*node-version:\s*(.+?)\s*$/.exec(l) || /[{,]\s*node-version:\s*('[^']*'|"[^"]*"|[^,}\s]+)/.exec(l);
      if (m) {
        const v = m[1].replace(/\s+#.*$/, '');
        const ex = /\$\{\{\s*matrix\.([\w-]+)\s*\}\}/.exec(v);
        if (ex) { const seen = new Set(); for (const x of matrix[ex[1]] || []) { if (seen.has(x.spec)) continue; seen.add(x.spec); out.push({ file: rel, line: x.line, spec: x.spec, via: `matrix.${ex[1]}` }); } }
        else if (/\$\{\{/.test(v)) out.push({ file: rel, line: i + 1, spec: null, via: 'expression' });
        else for (const s of parseList(v)) out.push({ file: rel, line: i + 1, spec: s, via: 'node-version' });
      }
      const vf = /(?:^\s*|[{,]\s*)node-version-file:\s*['"]?([^'"\s]+)/.exec(l);
      if (vf) out.push({ file: rel, line: i + 1, spec: null, via: `file:${vf[1]}` });
    });
  }
  return out;
}

/** Dependency engines from package-lock (v2/v3) or node_modules. [{ name, version, node, dev }] */
export function dependencyEngines(dir, pkg) {
  const out = [];
  const lock = read(join(dir, 'package-lock.json')) || read(join(dir, 'npm-shrinkwrap.json'));
  if (lock) {
    let j; try { j = JSON.parse(lock); } catch { j = null; }
    if (j?.packages) {
      for (const [path, p] of Object.entries(j.packages)) {
        if (!path || !path.includes('node_modules/') || p.link) continue;
        const node = typeof p.engines === 'object' && !Array.isArray(p.engines) ? p.engines?.node : Array.isArray(p.engines) ? p.engines.find((e) => /^node\b/.test(e))?.replace(/^node\s*/, '') : undefined;
        const name = path.slice(path.lastIndexOf('node_modules/') + 13);
        if (node) out.push({ name, version: p.version, node: String(node), dev: !!p.dev, optional: !!p.optional });
      }
      return { source: 'package-lock.json', deps: out };
    }
  }
  const nm = join(dir, 'node_modules');
  if (existsSync(nm)) {
    const devOnly = new Set(Object.keys(pkg.devDependencies || {}));
    const visit = (d, depth) => {
      let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (!e.isDirectory() && !e.isSymbolicLink()) continue;
        if (e.name.startsWith('@')) { visit(join(d, e.name), depth); continue; }
        if (e.name.startsWith('.')) continue;
        const p = read(join(d, e.name, 'package.json')); if (!p) continue;
        try { const j = JSON.parse(p); if (j.engines?.node) out.push({ name: j.name || e.name, version: j.version, node: String(j.engines.node), dev: devOnly.has(j.name) }); } catch { /* ignore */ }
        if (depth < 3) visit(join(d, e.name, 'node_modules'), depth + 1);
      }
    };
    visit(nm, 0);
    return { source: 'node_modules', deps: out };
  }
  return { source: null, deps: out };
}

const stripJsonc = (s) => s.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '').replace(/,(\s*[}\]])/g, '$1');
const jsonc = (s) => { try { return JSON.parse(stripJsonc(s)); } catch { return null; } };
const lineIn = (text, needle) => { const i = text.split(/\r?\n/).findIndex((l) => l.includes(needle)); return i === -1 ? undefined : i + 1; };

/** Node versions from dev containers and Renovate config: [{ source, file, line, spec }] */
export function extraVersionSources(dir, pkg) {
  const out = [];
  for (const f of ['.devcontainer/devcontainer.json', '.devcontainer.json']) {
    const t = read(join(dir, f)); if (!t) continue; const j = jsonc(t); if (!j) continue;
    const img = typeof j.image === 'string' ? /(?:javascript|typescript)-node:(?:\d+-)?(\d+(?:\.\d+){0,2})|(?:^|\/)node:(\d+(?:\.\d+){0,2})/.exec(j.image) : null;
    if (img) out.push({ source: 'devcontainer', file: f, line: lineIn(t, '"image"'), spec: img[1] || img[2] });
    for (const [k, v] of Object.entries(j.features || {})) if (/devcontainers\/features\/node(:|$)/.test(k) && v && typeof v === 'object' && v.version && !/^(lts|latest|none)$/.test(String(v.version))) out.push({ source: 'devcontainer', file: f, line: lineIn(t, 'features/node'), spec: String(v.version) });
  }
  const ren = [['renovate.json', null], ['renovate.json5', null], ['.renovaterc', null], ['.renovaterc.json', null], ['.github/renovate.json', null], ['.github/renovate.json5', null]];
  for (const [f] of ren) { const t = read(join(dir, f)); if (!t) continue; const j = jsonc(t); const n = j?.constraints?.node; if (n) out.push({ source: 'renovate', file: f, line: lineIn(t, '"node"') || lineIn(t, 'node:'), spec: String(n) }); }
  if (pkg?.renovate?.constraints?.node) out.push({ source: 'renovate', file: 'package.json', spec: String(pkg.renovate.constraints.node) });
  // Dependabot: an "ignore" rule for the node docker image / @types/node with versions [">= N"] caps what it will propose
  const db = read(join(dir, '.github/dependabot.yml')) || read(join(dir, '.github/dependabot.yaml'));
  if (db) { const lines = db.split(/\r?\n/); lines.forEach((l, i) => { if (/dependency-name:\s*['"]?(node|@types\/node)['"]?\s*$/.test(l)) for (let k = i + 1; k < Math.min(lines.length, i + 6); k++) { const m = /['"]?>=?\s*(\d+)(?:\.[\dx*]+)*['"]?/.exec(lines[k]); if (/versions?:|^\s*-/.test(lines[k]) && m) { out.push({ source: 'dependabot', file: '.github/dependabot.yml', line: k + 1, spec: `<${m[1]}`, cap: Number(m[1]) }); break; } } }); }
  return out;
}

/** packageManager field, lockfiles and their implied package-manager versions. */
export function packageManagerInfo(dir, pkg) {
  const pmField = typeof pkg?.packageManager === 'string' ? pkg.packageManager : null;
  const m = pmField ? /^(npm|pnpm|yarn|bun)@(\d+)\.(\d+)\.(\d+)(?:[-+][\w.+-]*)?$/.exec(pmField) : null;
  const locks = [];
  const npm = read(join(dir, 'package-lock.json')) || read(join(dir, 'npm-shrinkwrap.json'));
  if (npm) { let v = null; try { v = JSON.parse(npm).lockfileVersion; } catch { /* */ } locks.push({ pm: 'npm', file: 'package-lock.json', lockfileVersion: v, minMajor: v >= 2 ? 7 : 5, maxMajor: v === 1 ? 6 : undefined }); }
  const pnpm = read(join(dir, 'pnpm-lock.yaml'));
  if (pnpm) { const v = /^lockfileVersion:\s*['"]?([\d.]+)/m.exec(pnpm)?.[1]; const f = parseFloat(v); const minMajor = f >= 9 ? 9 : f >= 6 ? 8 : f >= 5.4 ? 7 : f >= 5.3 ? 6 : 5; locks.push({ pm: 'pnpm', file: 'pnpm-lock.yaml', lockfileVersion: v, minMajor, maxMajor: f >= 9 ? undefined : f >= 6 ? 8 : 7 }); }
  const yarn = read(join(dir, 'yarn.lock'));
  if (yarn) { const berry = /^__metadata:/m.test(yarn); locks.push({ pm: 'yarn', file: 'yarn.lock', lockfileVersion: berry ? 'berry' : '1', minMajor: berry ? 2 : 1, maxMajor: berry ? undefined : 1 }); }
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) locks.push({ pm: 'bun', file: existsSync(join(dir, 'bun.lock')) ? 'bun.lock' : 'bun.lockb', minMajor: 1 });
  return { field: pmField, valid: !pmField || !!m, pm: m?.[1] ?? null, version: m ? { major: +m[2], minor: +m[3], patch: +m[4] } : null, locks };
}
