import { foundryBuild } from "./lib/build.ts";
import { writeJSONOutput, writeOutput } from "./lib/output.ts";

const { getContractReader } = await foundryBuild(
  "git@github.com:citrus-finance/citrus-tokens.git",
  {
    commit: "76a2c80b25983b761d886526f40ef447fdc323ca",
  },
);

const ERC20VotesContract = getContractReader("VotesToken");

await writeJSONOutput("contracts/VotesToken/abi.json", ERC20VotesContract.getABI());
await writeOutput("contracts/VotesToken/bytecode", ERC20VotesContract.getBytecode());
