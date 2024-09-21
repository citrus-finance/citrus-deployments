import { readFile } from "fs/promises";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import {
  Call,
  DeterministicContractDeployment,
  DynamicContractDeployment,
} from "../types/Call";
import {
  getCreate2Address,
  slice,
  Hex,
  concat,
  isHex,
  PublicClient as ViemPublicClient,
  WalletClient as ViemWalletClient,
  Transport,
  Chain,
  Account,
  getAddress,
  getCreateAddress,
} from "viem";
import pRetry from "p-retry";
import { mapValues } from "lodash";

const create2Contract = "0x914d7fec6aac8cd542e72bca78b30650d45643d7";
const wNative = "0xe91d153e0b41518a2ce8dd3d7944fa863463a97d";

const contractAddressMap: Record<string, Hex> = {};

export default async function applyTask(
  _rags: TaskArguments,
  hre: HardhatRuntimeEnvironment,
) {
  const [walletClient] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  if (!walletClient) {
    throw new Error("Missing DEPLOYER_PRIVATE_KEY in .env");
  }

  if (publicClient.chain.id === 31337) {
    throw new Error("Missing RPC_URL in .env");
  }

  const deployer = new CitrusDeployer({
    publicClient,
    walletClient,
    fetchFile: async (path) => {
      try {
        const file = await readFile(path, {
          encoding: "utf-8",
        });

        return JSON.parse(file);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return null;
        }

        throw err;
      }
    },
    etherscanKey: process.env.ETHERSCAN_API_KEY,
  });

  await deployer.deploy();
}

type PublicClient = ViemPublicClient<Transport, Chain>;
type WalletClient = ViemWalletClient<Transport, Chain, Account>;

type FileFetcher = <T = object>(path: string) => Promise<T | null>;

class CitrusDeployer {
  private publicClient: PublicClient;
  private walletClient: WalletClient;

  private fetchFile: FileFetcher;

  private etherscanKey?: string;

  constructor({
    publicClient,
    walletClient,
    fetchFile,
    etherscanKey,
  }: {
    publicClient: PublicClient;
    walletClient: WalletClient;
    fetchFile: FileFetcher;
    etherscanKey?: string;
  }) {
    this.publicClient = publicClient;
    this.walletClient = walletClient;
    this.fetchFile = fetchFile;
    this.etherscanKey = etherscanKey;
  }

  public async deploy() {
    const calls = await this.fetchFile<Call[]>("public/calls.json");

    if (calls === null) {
      throw new Error("calls.json file not found");
    }

    for (const call of calls) {
      if (call.type === "deterministic-deployment") {
        await this.deployContract(call);
      } else if (call.type === "dynamic-deployment") {
        const constructorArgs = getConstructorArgs(call.constructorArgs);

        await this.deployContract({
          name: call.name,
          bytecode: call.bytecode,
          constructorArgs,
        });
      } else if (call.type === "call") {
        // TODO: maybe find a better way to check if something was already executed
        const shouldExecute = await (async () => {
          try {
            await this.publicClient.call({
              to: call.to,
              data: call.calldata,
            });
            return true;
          } catch {
            return false;
          }
        })();

        if (shouldExecute) {
          // TODO: handle gas
          const txHash = await this.walletClient.sendTransaction({
            to: call.to,
            data: call.calldata,
          });

          const txReceipt = await pRetry(() =>
            this.publicClient.getTransactionReceipt({
              hash: txHash,
            }),
          );

          if (txReceipt.status === "reverted") {
            throw new Error(`Failed to run ${call.functionName}`);
          }

          console.log(`${call.functionName} executed`);
        }
      } else {
        // @ts-ignore
        throw new Error(`Call type ${call.type} not handled`);
      }
    }
  }

  private async deployContract(
    call: Omit<DeterministicContractDeployment, "type">,
  ) {
    const calldata = concat([call.bytecode, call.constructorArgs]);

    const salt = slice(calldata, 0, 32);
    const bytecode = slice(calldata, 32);

    const contractAddress = getCreate2Address({
      from: create2Contract,
      bytecode,
      salt,
    });
    contractAddressMap[call.name] = contractAddress;

    const code = await this.publicClient.getCode({
      address: contractAddress,
    });

    if (call.children) {
      for (let i = 0; i < call.children.length; i++) {
        const childAddress = getCreateAddress({
          from: contractAddress,
          nonce: BigInt(i) + 1n,
        });

        contractAddressMap[call.children[i].name] = childAddress;
        console.log(
          `${call.children[i].name} is deployed by ${call.name} at ${childAddress}`,
        );
      }
    }

    if (code) {
      console.log(`${call.name} is already deployed at ${contractAddress}`);
      return;
    }

    console.log(`Deploying ${call.name} to ${contractAddress}`);

    const gasEstimate = await this.publicClient.estimateGas({
      to: create2Contract,
      data: calldata,
    });

    const txHash = await this.walletClient.sendTransaction({
      to: create2Contract,
      data: calldata,
      gas: (gasEstimate * 110n) / 100n,
    });

    const txReceipt = await pRetry(() =>
      this.publicClient.getTransactionReceipt({
        hash: txHash,
      }),
    );

    if (txReceipt.status === "reverted") {
      throw new Error(`Failed to deploy ${call.name}`);
    }

    console.log(`Deployed ${call.name} to ${contractAddress}`);

    await this.verifyContract(call.name, call.constructorArgs, contractAddress);

    if (call.children) {
      for (let i = 0; i < call.children.length; i++) {
        const childAddress = getCreateAddress({
          from: contractAddress,
          nonce: BigInt(i) + 1n,
        });

        await this.verifyContract(
          call.children[i].name,
          getConstructorArgs(call.children[i].constructorArgs),
          childAddress,
        );
      }
    }
  }

  private async verifyContract(
    contractName: string,
    constructorArgs: Hex,
    contractAddress: string,
  ) {
    const metadata = await this.fetchFile<any>(
      `public/metadata/${contractName}.json`,
    );
    const input = await this.fetchFile<any>(
      `public/solidity-standard-json-input/${contractName}.json`,
    );

    if (metadata === null || input === null) {
      return;
    }

    const sourcifyResponse = await fetch("https://sourcify.dev/server/verify", {
      method: "POST",
      body: JSON.stringify({
        address: contractAddress,
        chain: this.publicClient.chain.id.toString(),
        files: {
          "metadata.json": JSON.stringify(metadata),
          ...mapValues(
            metadata.sources,
            (_k, sourceName) => input.sources[sourceName].content,
          ),
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log(
      `Sourcify verification result for ${contractName}`,
      await sourcifyResponse.json(),
    );

    if (this.etherscanKey) {
      const etherscanResponse = await fetch("https://api.etherscan.io/api", {
        method: "POST",
        body: new URLSearchParams({
          apikey: this.etherscanKey,
          module: "contract",
          action: "verifysourcecode",
          contractaddress: contractAddress,
          sourceCode: JSON.stringify(input),
          codeformat: "solidity-standard-json-input",
          contractname: `${Object.keys(metadata.settings.compilationTarget)[0]}:${contractName}`,
          compilerversion: `v${metadata.compiler.version}`,
          constructorArguements: constructorArgs.slice(2),
          // TODO: check if chain is supported
          chainId: this.publicClient.chain.id.toString(),
        }).toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      console.log(
        `Etherscan verification result for ${contractName}`,
        await etherscanResponse.json(),
      );
    }
  }
}

function getConstructorArgs(
  constructorArgs: DynamicContractDeployment["constructorArgs"],
): Hex {
  return concat(
    constructorArgs.map((p) => {
      if (isHex(p)) {
        return p;
      }

      if (p === "wnative") {
        return wNative;
      }

      if (contractAddressMap[p]) {
        return contractAddressMap[p];
      }

      throw new Error(`Could not replace ${p} in dynamic contract deployment`);
    }),
  );
}
