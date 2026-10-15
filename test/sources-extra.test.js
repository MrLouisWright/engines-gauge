import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyze, extraVersionSources, packageManagerInfo, suggestEngines, saveEngines } from '../src/index.js';

const now = new Date('2026-10-14T12:00:00Z');
const bin = new URL('../bin/engines-gauge.js', import.meta.url).pathname;
const rules = (dir) => analyze(dir, { now }).findings.map((f) => f.rule);
function proj(files) { const d = mkdtempSync(join(tmpdir(), 'eg-')); for (const [p, c] of Object.entries(files)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), typeof c === 'string' ? c : JSON.stringify(c, null, 2)); } return d; }
const lock = (pkgs) => ({ name: 'p', lockfileVersion: 3, packages: { '': {}, ...pkgs } });

test('devcontainer image and node feature are read as pins', () => {
  const d = proj({ 'package.json': { name: 'p', engines: { node: '>=20' } }, '.devcontainer/devcontainer.json': '{\n // c\n "image": "mcr.microsoft.com/devcontainers/typescript-node:1-18",\n "features": { "ghcr.io/devcontainers/features/node:1": { "version": "16" } }\n}' });
  const s = extraVersionSources(d, {});
  assert.deepEqual(s.map((x) => [x.source, x.spec]), [['devcontainer', '18'], ['devcontainer', '16']]);
  assert.equal(rules(d).filter((r) => r === 'runtime-pin-outside-engines').length, 2);
});
test('renovate constraints.node is checked against engines', () => {
  const d = proj({ 'package.json': { name: 'p', engines: { node: '>=20' } }, 'renovate.json': { constraints: { node: '18' } } });
  assert.ok(rules(d).includes('runtime-pin-outside-engines'));
});
test('dependabot ignore cap below engines', () => {
  const d = proj({ 'package.json': { name: 'p', engines: { node: '>=20' } }, '.github/dependabot.yml': 'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n    ignore:\n      - dependency-name: "@types/node"\n        versions: [">=22"]\n' });
  assert.ok(rules(d).includes('dependabot-cap-below-engines'));
});
test('packageManager vs lockfile', () => {
  assert.ok(rules(proj({ 'package.json': { name: 'p', engines: { node: '>=20' }, packageManager: 'pnpm@9.1.0' }, 'package-lock.json': lock({}) })).includes('package-manager-lockfile-mismatch'));
  assert.ok(rules(proj({ 'package.json': { name: 'p', engines: { node: '>=20' }, packageManager: 'pnpm@8.15.0' }, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" })).includes('package-manager-lockfile-mismatch'));
  assert.ok(!rules(proj({ 'package.json': { name: 'p', engines: { node: '>=20' }, packageManager: 'pnpm@9.1.0' }, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" })).some((r) => r.startsWith('package-manager')));
  assert.ok(rules(proj({ 'package.json': { name: 'p', engines: { node: '>=20' }, packageManager: 'yarn@1.22.19' }, 'yarn.lock': '__metadata:\n  version: 8\n' })).includes('package-manager-lockfile-mismatch'));
  assert.ok(rules(proj({ 'package.json': { name: 'p', engines: { node: '>=20' }, packageManager: 'pnpm' } })).includes('package-manager-invalid'));
  assert.ok(rules(proj({ 'package.json': { name: 'p', engines: { node: '>=20', npm: '>=10' }, packageManager: 'npm@9.0.0' }, 'package-lock.json': lock({}) })).includes('package-manager-engines-conflict'));
  assert.ok(rules(proj({ 'package.json': { name: 'p', engines: { node: '>=20' } }, 'package-lock.json': lock({}), 'yarn.lock': '# yarn v1\n' })).includes('multiple-lockfiles'));
  assert.equal(packageManagerInfo(proj({ 'package.json': {} }), { packageManager: 'npm@10.2.3+sha512.abc' }).pm, 'npm');
});
test('suggestEngines and saveEngines (ls-engines --save)', () => {
  const d = proj({ 'package.json': { name: 'p', dependencies: { a: '1', b: '1' } }, 'package-lock.json': lock({ 'node_modules/a': { version: '1.0.0', engines: { node: '>=18.17' } }, 'node_modules/b': { version: '1.0.0', engines: { node: '^20.11.0 || >=22' } }, 'node_modules/c': { version: '1.0.0', dev: true, engines: { node: '>=24' } } }) });
  assert.equal(suggestEngines(d, { now }), '>=20.11.0');
  assert.deepEqual(saveEngines(d, { now }), { from: null, to: '>=20.11.0' });
  assert.equal(JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).engines.node, '>=20.11.0');
  assert.equal(saveEngines(d, { now }), null);
});
test('CLI --suggest and --save', () => {
  const d = proj({ 'package.json': { name: 'p', dependencies: { a: '1' } }, 'package-lock.json': lock({ 'node_modules/a': { version: '1.0.0', engines: { node: '>=20' } } }) });
  const r = spawnSync(process.execPath, [bin, d, '--suggest', '--save', '--fail-on', 'none'], { encoding: 'utf8' });
  assert.match(r.stderr, /suggested engines.node: >=20.0.0/); assert.match(r.stderr, /-> >=20.0.0/); assert.equal(r.status, 0);
});
