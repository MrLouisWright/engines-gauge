#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mainCli, check, RULES, splitList, saveEngines, suggestEngines } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mainCli({
  name: 'engines-gauge', version: pkg.version, configKey: 'enginesGauge', rules: RULES,
  tagline: 'make engines.node, the CI matrix, .nvmrc and dependency engines agree',
  usage: 'Usage: engines-gauge [dir] [options]',
  help: `Checks
      --ignore-deps <globs>   Dependencies whose engines are ignored (comma-separated)
      --strict-minimum        Require CI to test the engines minimum even if it is end-of-life
      --require-engines       Report missing engines.node even for private packages
      --suggest               Print the lowest engines.node range your dependencies allow (to stderr)
      --save                  Write that range to package.json engines.node (only raises it)
`,
  options: { 'ignore-deps': { type: 'string', multiple: true }, 'strict-minimum': { type: 'boolean' }, 'require-engines': { type: 'boolean' }, suggest: { type: 'boolean' }, save: { type: 'boolean' } },
  run: async ({ dir, values: o, config, configFile }) => {
    const opts = { ignoreDeps: splitList(o['ignore-deps']), strictMinimum: o['strict-minimum'] || undefined, requireEngines: o['require-engines'] || undefined, toolVersion: pkg.version };
    if (o.suggest) process.stderr.write(`suggested engines.node: ${suggestEngines(dir, { ignoreDeps: [...(config.ignoreDeps || []), ...opts.ignoreDeps] }) ?? '(no dependency declares engines)'}\n`);
    if (o.save) { const r = saveEngines(dir, { ignoreDeps: [...(config.ignoreDeps || []), ...opts.ignoreDeps] }); process.stderr.write(r ? `engines.node: ${r.from ?? '(none)'} -> ${r.to}\n` : 'engines.node already satisfies your dependencies\n'); }
    return check(dir, opts, config, configFile);
  },
});
