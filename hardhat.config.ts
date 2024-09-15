import "dotenv/config";

import path from "path";
import { readFileSync } from "fs";

import { subtask, task, type HardhatUserConfig } from "hardhat/config";
import {
  TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS,
  TASK_COMPILE_SOLIDITY_READ_FILE,
} from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox-viem";
import multimatch from "multimatch";
import findUp from "find-up";

import planTask from "./tasks/plan";
import applyTask from "./tasks/apply";

const sourcePaths = [
  "contracts/citrus-safe-modules/src/**/*.sol",
  "contracts/joe-v2/src/**/*.sol",
  "contracts/joe-core/contracts/traderjoe/**/*.sol",
];

subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(
  async (_, __, runSuper) => {
    const paths: string[] = await runSuper();

    return multimatch(
      paths,
      sourcePaths.map((x) =>
        x[0] === "!"
          ? `!${process.cwd()}/${x.slice(1)}`
          : `${process.cwd()}/${x}`,
      ),
    );
  },
);

subtask(
  TASK_COMPILE_SOLIDITY_READ_FILE,
  async (
    { absolutePath }: { absolutePath: string },
    hre,
    runSuper,
  ): Promise<string> => {
    let content = await runSuper({ absolutePath });

    return content
      .split(/\r?\n/)
      .map((line: string) => {
        if (line.match(/^\s*import /i)) {
          getRemappings(absolutePath).forEach(([find, replace]) => {
            if (!replace.includes("node_modules") && line.match(find)) {
              line = line.replace(find, replace);
            }
          });
        }
        return line;
      })
      .join("\n");
  },
);

function getRemappings(filePath: string): string[][] {
  const remappingsPath = findUp.sync("remappings.txt", {
    cwd: path.dirname(filePath),
  });

  if (!remappingsPath) {
    return [];
  }

  const relativePath = path.relative(
    path.dirname(filePath),
    path.dirname(remappingsPath),
  );

  return readFileSync(remappingsPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().split("="))
    .map((x) => [x[0], relativePath + "/" + x[1]]);
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 800,
          },
        },
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 800,
          },
        },
      },
    ],
  },
  defaultNetwork: process.env.RPC_URL ? "default" : undefined,
  networks: {
    ...(process.env.RPC_URL
      ? {
          default: {
            url: process.env.RPC_URL,
            accounts: process.env.DEPLOYER_PRIVATE_KEY
              ? [process.env.DEPLOYER_PRIVATE_KEY]
              : [],
          },
        }
      : {}),
  },
};

task("plan").setAction(planTask);
task("apply").setAction(applyTask);

export default config;
