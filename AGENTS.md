# Agent instructions

## What this project does

Compiles Solidity contracts from external git repositories (pinned to specific commits) using Foundry, and publishes the resulting artifacts (ABI, bytecode) into `public/` so end users can deploy the contracts without a Solidity toolchain. `public/` is the product; everything else is build machinery.

## Running

```sh
pnpm install
node src/index.ts   # requires Foundry (forge) and git SSH access to source repos
```

No build/compile step for the TypeScript itself — Node runs `.ts` files directly (type stripping), hence `.ts` extensions in imports. There are no tests.

## Architecture

- [src/index.ts](src/index.ts) — the build manifest: lists which repos/commits to compile and which contract artifacts to write. Add new contracts here.
- [src/lib/build.ts](src/lib/build.ts) — `foundryBuild(url, { commit, solVersion })`: pulls the repo and runs `forge compile`, returns a `FoundryReader`.
- [src/lib/git.ts](src/lib/git.ts) — clones into `.cache/<org>/<repo>` (shallow); each commit gets an immutable worktree at `.cache/<org>/<repo>@<sha>`, which is where compiles run. Requires full 40-char commit hashes (short hashes can't be fetched by SHA).
- [src/lib/foundry-reader.ts](src/lib/foundry-reader.ts) — reads `out/<Name>.sol/<Name>.json` from a compiled checkout; implements the [ContractReader](src/lib/contract-reader.ts) interface (`getABI`, `getBytecode`, `getMetadata`, `getStandardInputJSON`). Metadata/standard-input normalize `node_modules/` prefixes out of source paths and remappings (for verifier compatibility).
- [src/lib/output.ts](src/lib/output.ts) — writes into `public/`. `writeJSONOutput` emits both pretty (`.json`) and minified (`.min.json`) variants.
- [src/lib/lock.ts](src/lib/lock.ts) — in-process async mutex keyed by string; used to serialize git operations per repo and forge compiles per checkout.

## Conventions & gotchas

- `public/` is committed; `.cache/` and `node_modules/` are gitignored. Never hand-edit files in `public/` — regenerate them via `src/index.ts`.
- Output layout: `public/contracts/<ContractName>/{abi.json,abi.min.json,bytecode}`. Keep the README's contract table in sync when adding contracts.
- Source repos are always pinned: `foundryBuild` requires a full commit hash, so builds are reproducible and every compile directory is write-once.
- `getBytecode()` throws for abstract contracts/interfaces (bytecode `"0x"`).
- Prettier runs on commit via husky + lint-staged; `pnpm format` to run manually.
