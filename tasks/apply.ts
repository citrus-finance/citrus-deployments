import { readFile } from "fs/promises";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { Call } from "../types/Call";
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

  const calls = await readCallsFile();

  await deploy(publicClient, walletClient, calls);
}

type PublicClient = ViemPublicClient<Transport, Chain>;
type WalletClient = ViemWalletClient<Transport, Chain, Account>;

async function deploy(
  publicClient: PublicClient,
  walletClient: WalletClient,
  calls: Call[],
) {
  for (const call of calls) {
    if (call.type === "deterministic-deployment") {
      await deployContract(
        publicClient,
        walletClient,
        call.name,
        call.bytecode,
      );
    } else if (call.type === "dynamic-deployment") {
      const bytecode = concat(
        call.bytecodeParts.map((p) => {
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

      await deployContract(publicClient, walletClient, call.name, bytecode);
    } else if (call.type === "call") {
      // TODO: maybe find a better way to check if something was already executed
      const shouldExecute = await (async () => {
        try {
          await publicClient.call({
            to: call.to,
            data: call.calldata,
          });
          return true;
        } catch {
          return false;
        }
      })();

      if (shouldExecute) {
        const txHash = await walletClient.sendTransaction({
          to: call.to,
          data: call.calldata,
        });

        const txReceipt = await pRetry(() =>
          publicClient.getTransactionReceipt({
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

async function deployContract(
  publicClient: PublicClient,
  walletClient: WalletClient,
  name: string,
  calldata: Hex,
) {
  const salt = slice(calldata, 0, 32);
  const bytecode = slice(calldata, 32);

  const contractAddress = getCreate2Address({
    from: create2Contract,
    bytecode,
    salt,
  });
  contractAddressMap[name] = contractAddress;

  const code = await publicClient.getCode({
    address: contractAddress,
  });

  if (code) {
    console.log(`${name} is already deployed at ${contractAddress}`);
    return;
  }

  console.log(`Deploying ${name} to ${contractAddress}`);

  const txHash = await walletClient.sendTransaction({
    to: create2Contract,
    data: calldata,
  });

  const txReceipt = await pRetry(() =>
    publicClient.getTransactionReceipt({
      hash: txHash,
    }),
  );

  if (txReceipt.status === "reverted") {
    throw new Error(`Failed to deploy ${name}`);
  }

  console.log(`Deployed ${name} to ${contractAddress}`);
}

async function readCallsFile(): Promise<Call[]> {
  const file = await readFile("calls.json", {
    encoding: "utf-8",
  }).catch(() => "[]");

  return JSON.parse(file);
}
