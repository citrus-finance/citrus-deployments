import { ArtifactsMap } from "hardhat/types";
import { Hex } from "viem";

interface DeterministicContractDeployment {
  type: "deterministic-deployment";
  name: string;
  bytecode: Hex;
}

interface DynamicContractDeployment {
  type: "dynamic-deployment";
  name: string;
  bytecodeParts: (Hex | "wnative" | keyof ArtifactsMap)[];
}

interface ContractCall {
  type: "call";
  contractName: string;
  functionName: string;
  to: Hex;
  calldata: Hex;
}

export type Call =
  | DeterministicContractDeployment
  | DynamicContractDeployment
  | ContractCall;
