# Changelog

## 1.0.0 (2026-10-14)

First release, by Louis Wright.

- Sources: `engines.node`, GitHub Actions `setup-node` versions (literal, `node-version-file`, and `${{ matrix.* }}` lists including `include:`), `.nvmrc`, `.node-version`, `.tool-versions`, Volta, Dockerfile `FROM node:*`, and `@types/node`.
- Dependency engines from `package-lock.json` (v2/v3) or installed `node_modules`, production and dev separately, with the minimum Node version that satisfies everything.
- Node release schedule built in (LTS codenames, EOL dates) for `lts/*`-style aliases and EOL warnings.
- Rules: engines-invalid, dependency-engines-conflict, nvmrc-outside-engines, ci-outside-engines, ci-missing-minimum, engines-missing, runtime-pin-outside-engines, dev-dependency-engines-conflict, types-node-ahead, ci-missing-pinned, engines-eol, ci-eol.
- Text/JSON/SARIF/Markdown output, `--fail-on`, exit codes 0/1/2, allowlist with expiry, severity overrides.
- Composite GitHub Action with job summary.
