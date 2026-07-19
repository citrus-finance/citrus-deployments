import { foundryBuild } from "./lib/build.ts";
import { writeJSONOutput, writeOutput } from "./lib/output.ts";

const { getContractReader } = await foundryBuild(
  "git@github.com:citrus-finance/citrus-tokens.git",
  {
    commit: "95abf07d9c0432ce673ea5099c38d7c6ce67459c",
  },
);

const ERC20VotesContract = getContractReader("VotesToken");

await writeJSONOutput("contracts/tokens/VotesToken/abi.json", ERC20VotesContract.getABI());
await writeOutput("contracts/tokens/VotesToken/bytecode", ERC20VotesContract.getBytecode());
