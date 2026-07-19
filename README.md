# citrus-deployments

Precompiled Citrus smart contracts. The ABI and bytecode are checked into this repo, so you can deploy the contracts without installing a Solidity toolchain.

## Using the artifacts

Everything you need is in the [public/](public/) folder, which is served at https://assets.citrus.finance/ (`public/` is the root). Each contract has its own directory:

```
public/
└── contracts/
    └── <ContractName>/
        ├── abi.json      # ABI, pretty-printed
        ├── abi.min.json  # ABI, minified (same content)
        └── bytecode      # creation bytecode, 0x-prefixed hex
```

### Deploying with viem

```ts
const abi = await fetch("https://assets.citrus.finance/contracts/VotesToken/abi.min.json").then(
  (res) => res.json(),
);

const bytecode = await fetch("https://assets.citrus.finance/contracts/VotesToken/bytecode").then(
  (res) => res.text(),
);

const hash = await walletClient.deployContract({
  abi,
  bytecode: bytecode as `0x${string}`,
  args: [/* constructor args */],
});
```

The same files work with ethers, web3.js, `cast send --create`, or anything else that takes an ABI and creation bytecode.

## Available contracts

| Contract   | ABI                                              | Bytecode                                         |
| ---------- | ------------------------------------------------ | ------------------------------------------------ |
| VotesToken | [abi.json](public/contracts/VotesToken/abi.json) | [bytecode](public/contracts/VotesToken/bytecode) |

## How to generate the artifacts

Requires [Foundry](https://getfoundry.sh/) (`forge`) and git SSH access to the source repos.

```sh
pnpm install
node src/index.ts
```

This regenerates the files under `public/`.
