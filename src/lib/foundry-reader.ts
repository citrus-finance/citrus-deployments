import type { Abi, Hex } from "viem";
import type { ContractReader } from "./contract-reader.ts";
import { readFileSync } from "fs";
import type { Metadata } from "./metadata.ts";
import mapKeys from "lodash/mapKeys.js";
import map from "lodash/map.js";
import type { StandardInputJSON } from "./standard-input-json.ts";

export default class FoundryReader {
  dir: string;

  constructor(directory: string) {
    this.dir = directory;
  }

  getContractReader = (contractName: string): ContractReader => {
    return new FoundryContractReader(this.dir, contractName);
  };
}

class FoundryContractReader implements ContractReader {
  dir: string;
  contractName: string;

  constructor(directory: string, contractName: string) {
    this.dir = directory;
    this.contractName = contractName;
  }

  private getOutputFile() {
    const content = readFileSync(
      `${this.dir}/out/${this.contractName}.sol/${this.contractName}.json`,
      "utf8",
    );

    return JSON.parse(content);
  }

  getName(): string {
    return this.contractName;
  }

  getABI(): Abi {
    return this.getOutputFile().abi;
  }

  getBytecode(): Hex {
    const bytecode = this.getOutputFile().bytecode.object;

    if (bytecode === "0x") {
      throw new Error(
        `Contract ${this.contractName} has no deployable bytecode (it is likely abstract or an interface)`,
      );
    }

    return bytecode;
  }

  getMetadata(): Metadata {
    const metadata: Metadata = this.getOutputFile().metadata;

    return {
      ...metadata,
      output: {
        ...metadata.output,
        abi: metadata.output.abi.map((x) => {
          if (x.type === "function") {
            return {
              ...x,
              outputs: x.outputs ?? [],
            };
          }

          return x;
        }),
      },
      settings: {
        ...metadata.settings,
        remappings: metadata.settings.remappings.map((x: string) =>
          x.replaceAll("node_modules/", ""),
        ),
      },
      sources: mapKeys(metadata.sources, (_value, key) =>
        key.startsWith("node_modules/") ? key.slice(13) : key,
      ),
    };
  }

  getStandardInputJSON(): StandardInputJSON {
    const metadata = this.getOutputFile().metadata;

    return {
      language: metadata.language,
      sources: Object.fromEntries(
        map(metadata.sources, (_value, key: string) => {
          const fileName = key.startsWith("node_modules/") ? key.slice(13) : key;

          return [
            fileName,
            {
              content: readFileSync(`${this.dir}/${key}`, "utf8"),
            },
          ];
        }),
      ),
      settings: {
        optimizer: metadata.settings.optimizer,
        evmVersion: metadata.settings.evmVersion,
        remappings: metadata.settings.remappings.map((x: string) =>
          x.replaceAll("node_modules/", ""),
        ),
        outputSelection: {
          "*": {
            "*": [
              "abi",
              "evm.bytecode",
              "evm.deployedBytecode",
              "evm.methodIdentifiers",
              "metadata",
            ],
            "": ["ast"],
          },
        },
      },
    };
  }
}
