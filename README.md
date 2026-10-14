# engines-gauge

> Make `engines.node`, your CI matrix, `.nvmrc` and your dependencies' engine requirements agree.

`engines.node` is a promise to your users, and it drifts. CI quietly stops testing the minimum you claim. `.nvmrc` pins a version that `engines` forbids. A dependency update starts requiring Node 18.17 while your `package.json` still says `>=16`, so users on 16 get a broken install. `engines-gauge` reads every place a Node.js version is declared, cross-checks them, and reports each mismatch with the file, line, severity and a **concrete fix**.

CLI, library and GitHub Action. Node.js 18+, **zero runtime dependencies**. By Louis Wright.

## Features

- **Every source of truth:** `engines.node`; GitHub Actions `setup-node` (literal versions, `node-version-file`, and `${{ matrix.* }}` lists in flow, block and `include:` form); `.nvmrc`, `.node-version`, `.tool-versions`, Volta and Dockerfile `FROM node:*`; and `@types/node`.
- **Dependency engines:** read from `package-lock.json` (v2/v3) or installed `node_modules`. Production and dev dependencies are checked separately and optional ones are skipped. The fix tells you the minimum `engines.node` that satisfies everything you ship.
- **Node release schedule built in:** resolves `lts/*`, `lts/iron`, `lts/-1`, `node` and `22.x`, and flags end-of-life lines (as info, so supporting older Node is your call).
- **Output:** text, JSON, SARIF 2.1.0 and Markdown; `--fail-on`; exit codes 0/1/2; allowlist entries with expiry dates.

## Rules

| Rule | Default severity | What it catches |
|---|---|---|
| `engines-invalid` | high | engines.node is not a valid range |
| `dependency-engines-conflict` | high | A production dependency needs a newer Node.js than engines.node allows |
| `nvmrc-outside-engines` | high | .nvmrc / .node-version is outside engines.node |
| `ci-outside-engines` | medium | CI tests a Node.js version that engines.node does not allow |
| `ci-missing-minimum` | medium | CI never tests the minimum Node.js version engines.node claims |
| `engines-missing` | medium | No engines.node |
| `runtime-pin-outside-engines` | medium | Volta / .tool-versions / Dockerfile Node.js version is outside engines.node |
| `dev-dependency-engines-conflict` | low | A dev dependency needs a newer Node.js than CI or engines minimum |
| `types-node-ahead` | low | @types/node is newer than the minimum supported Node.js |
| `ci-missing-pinned` | low | CI does not test the version pinned in .nvmrc |
| `engines-eol` | info | engines.node allows an end-of-life Node.js version |
| `ci-eol` | info | CI tests an end-of-life Node.js version |
| `allowlist-expired` | medium | Allowlist entry has expired |
| `allowlist-unused` | info | Allowlist entry matched nothing |

## Install and run

```bash
npx engines-gauge                        # run in the package directory
npx engines-gauge --fail-on medium
npx engines-gauge --ignore-deps "fsevents,@esbuild/*"
npx engines-gauge --strict-minimum       # CI must test the engines minimum even if it is EOL
```

### Sample output

```text
engines-gauge — my-lib@1.0.0
engines.node ">=16"; CI: 14, 20, 22; pins: .nvmrc 15, volta 14.21.3; deps need ≥ 18.17.0 (fast-lib@5.1.0)

HIGH     .nvmrc:1 .nvmrc pins Node 15, outside engines.node ">=16" [nvmrc-outside-engines]
         ↳ fix: Pin a version engines.node allows (e.g. 16), or update engines.node.
HIGH     package-lock.json:4 fast-lib@5.1.0 requires node ">=18.17", but engines.node ">=16" allows Node 16, 17 [dependency-engines-conflict]
         ↳ fix: Raise engines.node to ">=18.17.0" (or pin an older fast-lib that still supports Node 16).
MEDIUM   .github/workflows/ci.yml:9 CI runs Node 14 (matrix.node-version) but engines.node ">=16" does not allow it [ci-outside-engines]
         ↳ fix: Remove it from the matrix or widen engines.node.
MEDIUM   package.json:5 package.json (volta.node) pins Node 14.21.3, outside engines.node ">=16" [runtime-pin-outside-engines]
         ↳ fix: Pin a version engines.node allows (e.g. 16), or update engines.node.
LOW      .nvmrc:1 .nvmrc pins Node 15 but CI never runs 15 [ci-missing-pinned]
         ↳ fix: Add 15 to the matrix (or use node-version-file: .nvmrc).
LOW      package-lock.json test-runner@3.0.0 requires node ">=20", but engines.node ">=16" allows Node 16, 17, 18, 19 [dev-dependency-engines-conflict]
         ↳ fix: Drop Node 16, 17, 18, 19 from CI/engines, or pin an older test-runner.
LOW      package.json:7 @types/node "^22.0.0" describes Node 22 APIs but engines.node allows Node 16 [types-node-ahead]
         ↳ fix: Use "@types/node": "^16" so the compiler rejects APIs your oldest supported Node lacks.
INFO     .github/workflows/ci.yml:9 CI tests Node 14, which reached end-of-life on 2023-04-30 [ci-eol]
         ↳ fix: Keep it only while engines.node still claims it.
INFO     .github/workflows/ci.yml:10 CI tests Node 20, which reached end-of-life on 2026-04-30 [ci-eol]
         ↳ fix: Keep it only while engines.node still claims it.
INFO     package.json:4 engines.node ">=16" allows end-of-life Node 16, 18, 20 [engines-eol]
         ↳ fix: Consider ">=22" in your next major release.

2 high, 2 medium, 3 low, 3 info
✔ Passing (fail-on: none).
```

## Options

```text
engines-gauge 1.0.0 — make engines.node, the CI matrix, .nvmrc and dependency engines agree

Usage: engines-gauge [dir] [options]

Checks
      --ignore-deps <globs>   Dependencies whose engines are ignored (comma-separated)
      --strict-minimum        Require CI to test the engines minimum even if it is end-of-life
      --require-engines       Report missing engines.node even for private packages

Common
  -c, --config <file>     JSON config (default: .engines-gauge.json or "enginesGauge" in package.json)
  -f, --format <fmt>      text (default) | json | sarif | markdown
      --json <file>       Also write a JSON report
      --sarif <file>      Also write SARIF 2.1.0
      --markdown <file>   Also write Markdown (e.g. for a job summary)
      --fail-on <sev>     critical | high | medium | low | info | none (default: high)
      --list-rules        Print rules and default severities
      --no-fixes          Hide fix suggestions in text output
      --no-color          Disable colours
  -v, --version / -h, --help

Exit codes: 0 = passed, 1 = findings at or above --fail-on, 2 = usage, config or read error.
```

## Configuration and allowlist

Options can live in `.engines-gauge.json` (or a `"enginesGauge"` key in `package.json`, or `--config <file>`):

```json
{
  "failOn": "medium",
  "severity": { "engines-eol": "low" },
  "allowlist": [
    { "rule": "ci-eol", "subject": "node@18", "reason": "Enterprise users still on 18 until Q1", "expires": "2027-03-31" }
  ],
  "ignoreDeps": ["fsevents"]
}
```

- **`severity`** changes a rule's severity, or turns it `"off"`.
- **`allowlist`** entries suppress matching findings. Each needs a `reason` and matches on any combination of `rule`, `file`, `subject` (globs with `*`) and `match` (a substring of the message). Add `expires` (`YYYY-MM-DD`) so the exception is time-boxed: once it lapses the finding comes back along with an `allowlist-expired` finding (medium). Entries that no longer match anything are reported as `allowlist-unused` (info).

Other config keys: `ignoreDeps`, `strictMinimum`, `requireEngines` and `maxDeps` (default 25 findings per dependency rule).

## Output and exit codes

- `--format text` (default), `json`, `sarif` (SARIF 2.1.0 for GitHub code scanning) or `markdown` (for job summaries and PR comments). `--json`, `--sarif` and `--markdown` write extra report files in the same run.
- `--fail-on <severity>` sets the threshold (`critical`, `high`, `medium`, `low`, `info`, `none`; default `high`).
- Exit codes: **0** passed, **1** findings at or above `--fail-on`, **2** usage, config or read error.

## GitHub Action

```yaml
permissions:
  contents: read
  security-events: write   # only needed for the SARIF upload
jobs:
  engines-gauge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with: { persist-credentials: false }
      - uses: MrLouisWright/engines-gauge@v1
        with:
          fail-on: high
          sarif: engines-gauge.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: engines-gauge.sarif }
```

| Input | Description | Default |
|---|---|---|
| `path` | Project directory | `.` |
| `fail-on` | Failure threshold | `high` |
| `config` | Config file path | |
| `sarif` / `json` | Write SARIF / JSON report to this path | |
| `job-summary` | Add the Markdown report to the job summary | `true` |
| `args` | Extra CLI arguments | |

The action runs the bundled CLI with Node 20; it has no dependencies to install. Pin it to a commit SHA if your policy requires it.

## Library

```js
import { check, toMajor, satisfies } from 'engines-gauge';
const report = check('.', { ignoreDeps: ['fsevents'] });
console.log(report.info.requiredByDeps); // { version: '18.17.0', by: 'fast-lib@5.1.0', ... }
toMajor('lts/*'); // e.g. 24
```

Types are included.

## Requirements

Node.js 18 or newer. Zero runtime dependencies.

## Licence

MIT © Louis Wright. See [LICENSE](LICENSE).
