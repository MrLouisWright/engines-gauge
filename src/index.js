import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { satisfies, minVersion, validRange, parseRange } from './range.js';
import { versionFiles, workflowVersions, dependencyEngines } from './sources.js';
import { toMajor, isEol, RELEASES, latestLts, currentMajor } from './node-releases.js';
import { buildReport, UsageError } from './core.js';

export { satisfies, minVersion, toMajor, isEol, latestLts, currentMajor, RELEASES, versionFiles, workflowVersions, dependencyEngines };
export * from './core.js';

export const RULES = {
  'engines-invalid': { severity: 'high', title: 'engines.node is not a valid range' },
  'dependency-engines-conflict': { severity: 'high', title: 'A production dependency needs a newer Node.js than engines.node allows' },
  'nvmrc-outside-engines': { severity: 'high', title: '.nvmrc / .node-version is outside engines.node' },
  'ci-outside-engines': { severity: 'medium', title: 'CI tests a Node.js version that engines.node does not allow' },
  'ci-missing-minimum': { severity: 'medium', title: 'CI never tests the minimum Node.js version engines.node claims' },
  'engines-missing': { severity: 'medium', title: 'No engines.node' },
  'runtime-pin-outside-engines': { severity: 'medium', title: 'Volta / .tool-versions / Dockerfile Node.js version is outside engines.node' },
  'dev-dependency-engines-conflict': { severity: 'low', title: 'A dev dependency needs a newer Node.js than CI or engines minimum' },
  'types-node-ahead': { severity: 'low', title: '@types/node is newer than the minimum supported Node.js' },
  'ci-missing-pinned': { severity: 'low', title: 'CI does not test the version pinned in .nvmrc' },
  'engines-eol': { severity: 'info', title: 'engines.node allows an end-of-life Node.js version' },
  'ci-eol': { severity: 'info', title: 'CI tests an end-of-life Node.js version' },
};

const vstr = (v) => `${v.major}.${v.minor}.${v.patch}`;
/** Smallest major in a range that the range admits (checks x.0.0 .. x.99.0). */
function majorsIn(range, from = 0, to = 40) { const out = []; for (let M = from; M <= to; M++) if ([0, 1, 5, 10, 20, 50].some((m) => satisfies(`${M}.${m}.0`, range))) out.push(M); return out; }
function admitsMajor(range, M) { return [0, 1, 2, 5, 9, 10, 15, 20, 30, 50, 99].some((m) => satisfies(`${M}.${m}.0`, range)); }

export function analyze(dir, opts = {}) {
  const now = opts.now || new Date();
  const pjPath = join(dir, 'package.json');
  if (!existsSync(pjPath)) throw new UsageError(`No package.json in ${dir}`);
  let pkg; try { pkg = JSON.parse(readFileSync(pjPath, 'utf8')); } catch (e) { throw new UsageError(`Cannot parse package.json: ${e.message}`); }
  const pjLines = readFileSync(pjPath, 'utf8').split('\n');
  const lineOf = (k) => { const i = pjLines.findIndex((l) => l.includes(`"${k}"`)); return i === -1 ? undefined : i + 1; };
  const findings = [];
  const add = (rule, subject, message, fix, loc = {}) => findings.push({ rule, severity: RULES[rule].severity, subject, file: loc.file || 'package.json', line: loc.line, message, fix });
  const engines = pkg.engines?.node;
  const ci = workflowVersions(dir).filter((x) => opts.ci !== false);
  const pins = versionFiles(dir, pkg);
  const deps = dependencyEngines(dir, pkg);
  const ignored = (n) => (opts.ignoreDeps || []).some((g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(n));
  const info = { engines: engines ?? null, ci: [], pins: pins.map((p) => ({ source: p.source, spec: p.spec })), depSource: deps.source, requiredByDeps: null };

  // resolve CI majors (node-version-file -> pins)
  const ciMajors = [];
  for (const c of ci) {
    let spec = c.spec;
    if (c.via?.startsWith('file:')) { const f = c.via.slice(5).replace(/^\.\//, ''); if (f === 'package.json') spec = engines ? String(minVersion(engines)?.major ?? '') : null; else spec = pins.find((p) => p.file === f)?.spec ?? (() => { try { return readFileSync(join(dir, f), 'utf8').trim().split(/\s+/).pop(); } catch { return null; } })(); }
    const M = toMajor(spec, now);
    if (M != null) { ciMajors.push({ ...c, major: M, spec }); info.ci.push(`${spec}${c.via?.startsWith('file:') ? ` (${c.via.slice(5)})` : ''}`); }
  }

  // engines itself
  let range = null;
  if (engines === undefined) { if (!pkg.private || opts.requireEngines) add('engines-missing', 'engines', 'package.json has no "engines.node"', `Declare what you support and test, e.g. "engines": { "node": ">=${ciMajors.length ? Math.min(...ciMajors.map((c) => c.major)) : latestLts(now) - 4}" }.`, { line: lineOf('name') }); }
  else if (typeof engines !== 'string' || !validRange(engines)) add('engines-invalid', 'engines', `engines.node "${engines}" is not a valid SemVer range`, 'Use a range like ">=18" or "^18.18 || >=20".', { line: lineOf('engines') });
  else range = engines;

  // dependency requirements -> required minimum
  let need = null; let needBy = null;
  const prodConflicts = []; const devConflicts = [];
  for (const d of deps.deps) {
    if (ignored(d.name) || d.optional) continue;
    if (!validRange(d.node)) continue;
    const lo = minVersion(d.node); if (!lo) continue;
    if (!d.dev && (!need || lo.major > need.major || (lo.major === need.major && (lo.minor > need.minor || (lo.minor === need.minor && lo.patch > need.patch))))) { need = lo; needBy = d; }
    if (range) {
      const ourMin = minVersion(range);
      // conflict: some major our range allows is rejected by the dependency
      const ourMajors = majorsIn(range, ourMin.major, Math.max(ourMin.major, currentMajor(now)));
      const bad = ourMajors.filter((M) => !admitsMajor(d.node, M) || (M === ourMin.major && !satisfies(vstr(ourMin), d.node)));
      if (bad.length) (d.dev ? devConflicts : prodConflicts).push({ d, bad, lo });
    } else if (d.dev && ciMajors.length) { const bad = ciMajors.filter((c) => !admitsMajor(d.node, c.major)).map((c) => c.major); if (bad.length) devConflicts.push({ d, bad, lo }); }
  }
  info.requiredByDeps = need ? { version: vstr(need), by: `${needBy.name}@${needBy.version}`, range: needBy.node } : null;
  const report = (list, rule) => {
    list.sort((a, b) => b.lo.major - a.lo.major || b.lo.minor - a.lo.minor);
    for (const { d, bad, lo } of list.slice(0, opts.maxDeps ?? 25)) add(rule, d.name, `${d.name}@${d.version} requires node "${d.node}", but ${rule.startsWith('dev') && !range ? 'CI tests' : 'engines.node "' + range + '" allows'} Node ${[...new Set(bad)].join(', ')}`, rule.startsWith('dev') ? `Drop Node ${[...new Set(bad)].join(', ')} from CI/engines, or pin an older ${d.name}.` : `Raise engines.node to ">=${vstr(lo)}" (or pin an older ${d.name} that still supports Node ${bad[0]}).`, { file: deps.source || 'package.json', line: rule.startsWith('dev') ? undefined : lineOf('engines') });
    if (list.length > (opts.maxDeps ?? 25)) add(rule, '(more)', `…and ${list.length - (opts.maxDeps ?? 25)} more dependencies`, 'Run with --json for the full list.');
  };
  report(prodConflicts, 'dependency-engines-conflict');
  report(devConflicts, 'dev-dependency-engines-conflict');

  if (range) {
    const min = minVersion(range);
    // CI
    if (ciMajors.length) {
      for (const c of ciMajors) if (!admitsMajor(range, c.major)) add('ci-outside-engines', `node@${c.major}`, `CI runs Node ${c.spec} (${c.via}) but engines.node "${range}" does not allow it`, `Remove it from the matrix or widen engines.node.`, { file: c.file, line: c.line });
      const tested = new Set(ciMajors.map((c) => c.major));
      if (!tested.has(min.major) && !(opts.ignoreEol !== false && isEol(min.major, now) && opts.strictMinimum !== true)) add('ci-missing-minimum', `node@${min.major}`, `engines.node "${range}" claims Node ${min.major} but CI only tests ${[...tested].sort((a, b) => a - b).join(', ')}`, `Add ${min.major} to the CI matrix, or raise engines.node to ">=${Math.min(...tested)}".`, { file: ciMajors[0].file, line: ciMajors[0].line });
      else if (!tested.has(min.major) && opts.strictMinimum === true) add('ci-missing-minimum', `node@${min.major}`, `engines.node "${range}" claims Node ${min.major} but CI only tests ${[...tested].sort((a, b) => a - b).join(', ')}`, `Add ${min.major} to the CI matrix, or raise engines.node.`, { file: ciMajors[0].file, line: ciMajors[0].line });
      for (const p of pins.filter((x) => x.source === '.nvmrc' || x.source === '.node-version')) { const M = toMajor(p.spec, now); if (M != null && !tested.has(M)) add('ci-missing-pinned', `node@${M}`, `${p.file} pins Node ${p.spec} but CI never runs ${M}`, `Add ${M} to the matrix (or use node-version-file: ${p.file}).`, { file: p.file, line: p.line }); }
    }
    // pins
    for (const p of pins) {
      const M = toMajor(p.spec, now); if (M == null) continue;
      const exact = /^v?\d+\.\d+\.\d+$/.test(p.spec.trim()) ? p.spec.trim().replace(/^v/, '') : null;
      const ok = exact ? satisfies(exact, range) : admitsMajor(range, M);
      if (!ok) add(p.source === '.nvmrc' || p.source === '.node-version' ? 'nvmrc-outside-engines' : 'runtime-pin-outside-engines', `${p.source}`, `${p.file}${p.source === 'volta' ? ' (volta.node)' : ''} pins Node ${p.spec}, outside engines.node "${range}"`, `Pin a version engines.node allows (e.g. ${min.major}), or update engines.node.`, { file: p.file, line: p.line ?? lineOf('volta') });
    }
    // @types/node
    const tn = pkg.devDependencies?.['@types/node'] || pkg.dependencies?.['@types/node'];
    if (tn && validRange(tn)) { const t = minVersion(tn); if (t && t.major > min.major) add('types-node-ahead', '@types/node', `@types/node "${tn}" describes Node ${t.major} APIs but engines.node allows Node ${min.major}`, `Use "@types/node": "^${min.major}" so the compiler rejects APIs your oldest supported Node lacks.`, { line: lineOf('@types/node') }); }
    // EOL
    const eolMajors = majorsIn(range, min.major, Math.max(min.major, currentMajor(now))).filter((M) => M % 2 === 0 && isEol(M, now));
    if (eolMajors.length) add('engines-eol', `node@${eolMajors[0]}`, `engines.node "${range}" allows end-of-life Node ${eolMajors.join(', ')}`, `Consider ">=${Math.max(...eolMajors) + (Math.max(...eolMajors) % 2 ? 1 : 2)}" in your next major release.`, { line: lineOf('engines') });
  }
  for (const c of ciMajors) if (isEol(c.major, now)) add('ci-eol', `node@${c.major}`, `CI tests Node ${c.spec}, which reached end-of-life on ${RELEASES[c.major]?.eol ?? 'an earlier date'}`, 'Keep it only while engines.node still claims it.', { file: c.file, line: c.line });
  // dedupe same rule+subject+file
  const seen = new Set();
  return { pkg, info, findings: findings.filter((f) => { const k = `${f.rule}|${f.subject}|${f.file}|${f.line}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
}

export function check(dir, opts = {}, config = {}, configFile) {
  const merged = { ignoreDeps: [...(config.ignoreDeps || []), ...(opts.ignoreDeps || [])], strictMinimum: opts.strictMinimum ?? config.strictMinimum, requireEngines: opts.requireEngines ?? config.requireEngines, now: opts.now, maxDeps: config.maxDeps };
  const { pkg, info, findings } = analyze(dir, merged);
  const tool = { name: 'engines-gauge', version: opts.toolVersion || '1.0.0', rules: RULES, emoji: '⚙️', defaultFile: 'package.json' };
  const line = `engines.node ${info.engines ? `"${info.engines}"` : '(none)'}; CI: ${info.ci.length ? [...new Set(info.ci)].join(', ') : 'none found'}; pins: ${info.pins.map((p) => `${p.source} ${p.spec}`).join(', ') || 'none'}${info.requiredByDeps ? `; deps need ≥ ${info.requiredByDeps.version} (${info.requiredByDeps.by})` : ''}`;
  return buildReport(tool, `${pkg.name || 'package'}${pkg.version ? '@' + pkg.version : ''}`, findings, config, { now: opts.now, configFile, summaryLine: line, info });
}
void parseRange;
