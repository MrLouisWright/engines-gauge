# Changelog

## 1.0.0 (2026-10-15)

### Added before first publish

- `--suggest` / `--save` (like ls-engines): work out the lowest `engines.node` your production dependencies allow and write it to package.json (only ever raises it). Library: `suggestEngines(dir)`, `saveEngines(dir)`. New info rule `engines-lower-than-needed`.
- More Node version sources: dev containers (`.devcontainer/devcontainer.json` image tag and the `features/node` version), Renovate `constraints.node` (renovate.json/json5, .renovaterc, `.github/`, package.json), and Dependabot ignore rules that cap `node`/`@types/node` (`dependabot-cap-below-engines`). setup-node `node-version-file` was already supported.
- `packageManager` / corepack checks: `package-manager-invalid`, `package-manager-lockfile-mismatch` (wrong tool, or a version that cannot read the lockfile's `lockfileVersion`), `package-manager-engines-conflict` (vs `engines.npm`/`pnpm`/`yarn`) and `multiple-lockfiles`.
- engines-gauge owns all `engines` checks in this package set (pkg-field-gauge does not check engines).

### Packaging

- Dual ESM + CommonJS: `import` loads `src/`, `require` loads a bundled `dist/index.cjs`, via package.json `exports`.
- TypeScript declarations are generated from the source (`dist/types`) instead of hand-written.
- CI runs build, tests and a require+import check on Node 18/20/22; releases use `npm publish --provenance`.

First release, by Louis Wright.

- Sources: `engines.node`, GitHub Actions `setup-node` versions (literal, `node-version-file`, and `${{ matrix.* }}` lists including `include:`), `.nvmrc`, `.node-version`, `.tool-versions`, Volta, Dockerfile `FROM node:*`, and `@types/node`.
- Dependency engines from `package-lock.json` (v2/v3) or installed `node_modules`, production and dev separately, with the minimum Node version that satisfies everything.
- Node release schedule built in (LTS codenames, EOL dates) for `lts/*`-style aliases and EOL warnings.
- Rules: engines-invalid, dependency-engines-conflict, nvmrc-outside-engines, ci-outside-engines, ci-missing-minimum, engines-missing, runtime-pin-outside-engines, dev-dependency-engines-conflict, types-node-ahead, ci-missing-pinned, engines-eol, ci-eol.
- Text/JSON/SARIF/Markdown output, `--fail-on`, exit codes 0/1/2, allowlist with expiry, severity overrides.
- Composite GitHub Action with job summary.
