#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mainCli, check, RULES, splitList } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mainCli({
  name: 'engines-gauge', version: pkg.version, configKey: 'enginesGauge', rules: RULES,
  tagline: 'make engines.node, the CI matrix, .nvmrc and dependency engines agree',
  usage: 'Usage: engines-gauge [dir] [options]',
  help: `Checks
      --ignore-deps <globs>   Dependencies whose engines are ignored (comma-separated)
      --strict-minimum        Require CI to test the engines minimum even if it is end-of-life
      --require-engines       Report missing engines.node even for private packages
`,
  options: { 'ignore-deps': { type: 'string', multiple: true }, 'strict-minimum': { type: 'boolean' }, 'require-engines': { type: 'boolean' } },
  run: async ({ dir, values: o, config, configFile }) => check(dir, { ignoreDeps: splitList(o['ignore-deps']), strictMinimum: o['strict-minimum'] || undefined, requireEngines: o['require-engines'] || undefined, toolVersion: pkg.version }, config, configFile),
});
