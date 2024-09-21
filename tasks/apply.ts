import { readFile } from "fs/promises";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { Call, DeterministicContractDeployment } from "../types/Call";
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
        const constructorArgs = concat(
          call.constructorArgs.map((p) => {
            if (isHex(p)) {
              return p;
            }

            if (p === "wnative") {
              return wNative;
            }

            if (contractAddressMap[p]) {
              return contractAddressMap[p];
            }

            throw new Error(
              `Could not replace ${p} in dynamic contract deployment for ${call.name}`,
            );
          }),
        );

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

    await this.verifyContract(call, contractAddress);
  }

  private async verifyContract(
    call: Omit<DeterministicContractDeployment, "type">,
    contractAddress: string,
  ) {
    const metadata = await this.fetchFile<any>(
      `public/metadata/${call.name}.json`,
    );
    const input = await this.fetchFile<any>(
      `public/solidity-standard-json-input/${call.name}.json`,
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
      `Sourcify verification result for ${call.name}`,
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
          contractname: `${Object.keys(metadata.settings.compilationTarget)[0]}:${call.name}`,
          compilerversion: `v${metadata.compiler.version}`,
          constructorArguements: call.constructorArgs.slice(2),
          // TODO: check if chain is supported
          chainId: this.publicClient.chain.id.toString(),
        }).toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      console.log(
        `Etherscan verification result for ${call.name}`,
        await etherscanResponse.json(),
      );
    }
  }
}
