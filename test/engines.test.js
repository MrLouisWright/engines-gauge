import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { check, analyze, toMajor, isEol, latestLts, currentMajor, workflowVersions, versionFiles, RULES } from '../src/index.js';

const now = new Date('2026-10-14T12:00:00Z');
const drift = new URL('./fixtures/drift', import.meta.url).pathname;
const bin = new URL('../bin/engines-gauge.js', import.meta.url).pathname;
const rules = (dir, o) => analyze(dir, { now, ...o }).findings.map((f) => f.rule);
function proj(files) { const d = mkdtempSync(join(tmpdir(), 'eg-')); for (const [p, c] of Object.entries(files)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), typeof c === 'string' ? c : JSON.stringify(c)); } return d; }
const wf = (body) => `name: ci\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n${body}`;

test('node release helpers', () => {
  assert.equal(latestLts(now), 24); assert.equal(currentMajor(now), 27);
  assert.equal(currentMajor(new Date('2026-02-01')), 25); assert.equal(currentMajor(new Date('2026-05-01')), 26);
  assert.equal(toMajor('lts/*', now), 24); assert.equal(toMajor('v20.11.1', now), 20); assert.equal(toMajor('22.x', now), 22);
  assert.equal(isEol(18, now), true); assert.equal(isEol(22, now), false);
});
test('drift fixture reports every planted problem', () => {
  const r = rules(drift);
  for (const x of ['nvmrc-outside-engines', 'dependency-engines-conflict', 'ci-outside-engines', 'runtime-pin-outside-engines', 'ci-missing-pinned', 'dev-dependency-engines-conflict', 'types-node-ahead', 'ci-eol', 'engines-eol']) assert.ok(r.includes(x), x);
});
test('optional deps are ignored; fix suggests the dependency minimum', () => {
  const f = analyze(drift, { now }).findings.filter((x) => x.rule === 'dependency-engines-conflict');
  assert.equal(f.length, 1); assert.equal(f[0].subject, 'fast-lib'); assert.match(f[0].fix, />=18\.17\.0/);
});
test('ignoreDeps config suppresses a dependency', () => {
  assert.ok(!rules(drift, { ignoreDeps: ['fast-*'] }).includes('dependency-engines-conflict'));
});
test('consistent project is clean apart from info', () => {
  const d = proj({ 'package.json': { name: 'ok', engines: { node: '>=22' }, devDependencies: { '@types/node': '^22.1.0' } }, '.nvmrc': '22\n', '.github/workflows/ci.yml': wf('    strategy:\n      matrix: { node: [22, 24] }\n    steps:\n      - uses: actions/setup-node@v4\n        with: { node-version: \'${{ matrix.node }}\' }\n') });
  assert.deepEqual(rules(d), []);
});
test('ci-missing-minimum for non-EOL minimum; strict mode for EOL minimum', () => {
  const d = proj({ 'package.json': { name: 'a', engines: { node: '>=22' } }, '.github/workflows/ci.yml': wf('    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n') });
  assert.ok(rules(d).includes('ci-missing-minimum'));
  const e = proj({ 'package.json': { name: 'a', engines: { node: '>=18' } }, '.github/workflows/ci.yml': wf('    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n') });
  assert.ok(!rules(e).includes('ci-missing-minimum'));
  assert.ok(rules(e, { strictMinimum: true }).includes('ci-missing-minimum'));
});
test('engines missing / invalid; private packages exempt unless required', () => {
  assert.ok(rules(proj({ 'package.json': { name: 'a' } })).includes('engines-missing'));
  assert.ok(!rules(proj({ 'package.json': { name: 'a', private: true } })).includes('engines-missing'));
  assert.ok(rules(proj({ 'package.json': { name: 'a', private: true } }), { requireEngines: true }).includes('engines-missing'));
  assert.ok(rules(proj({ 'package.json': { name: 'a', engines: { node: 'banana' } } })).includes('engines-invalid'));
});
test('workflow parsing: block list, include, node-version-file, flow with', () => {
  const d = proj({ 'package.json': { name: 'a' }, '.node-version': '20.11.0', '.github/workflows/ci.yml': wf('    strategy:\n      matrix:\n        node: [18, "20"]\n        include:\n          - node: 23\n    steps:\n      - uses: actions/setup-node@v4\n        with: { node-version: "${{ matrix.node }}" }\n      - uses: actions/setup-node@v4\n        with:\n          node-version-file: .node-version\n') });
  const v = workflowVersions(d);
  assert.deepEqual(v.filter((x) => x.via === 'matrix.node').map((x) => x.spec), ['18', '20', '23']);
  assert.ok(v.some((x) => x.via === 'file:.node-version'));
  assert.equal(versionFiles(d, {}).find((p) => p.source === '.node-version').spec, '20.11.0');
});
test('Dockerfile and .tool-versions pins', () => {
  const d = proj({ 'package.json': { name: 'a', engines: { node: '>=22' } }, Dockerfile: 'FROM node:20-alpine\n', '.tool-versions': 'nodejs 22.3.0\n' });
  const f = analyze(d, { now }).findings.filter((x) => x.rule === 'runtime-pin-outside-engines');
  assert.equal(f.length, 1); assert.equal(f[0].file, 'Dockerfile');
});
test('check() report, allowlist and exit codes', () => {
  const rep = check(drift, { now }, { allowlist: [{ rule: 'types-node-ahead', reason: 'tracked', expires: '2099-01-01' }] });
  assert.ok(!rep.findings.some((f) => f.rule === 'types-node-ahead'));
  const r = spawnSync(process.execPath, [bin, drift, '--fail-on', 'high']); assert.equal(r.status, 1);
  assert.equal(spawnSync(process.execPath, [bin, drift, '--fail-on', 'none']).status, 0);
  assert.equal(spawnSync(process.execPath, [bin, '/nonexistent-dir-xyz']).status, 2);
});
test('SARIF and list-rules', () => {
  const s = JSON.parse(execFileSync(process.execPath, [bin, drift, '-f', 'sarif', '--fail-on', 'none'], { encoding: 'utf8' }));
  assert.equal(s.version, '2.1.0'); assert.ok(s.runs[0].results.length > 5);
  const l = execFileSync(process.execPath, [bin, '--list-rules'], { encoding: 'utf8' });
  for (const k of Object.keys(RULES)) assert.ok(l.includes(k));
});
