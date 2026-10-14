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
