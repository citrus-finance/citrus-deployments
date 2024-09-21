import { ArtifactsMap } from "hardhat/types";
import { Hex } from "viem";

export interface DeterministicContractDeployment {
  type: "deterministic-deployment";
  name: string;
  bytecode: Hex;
  constructorArgs: Hex;
  children?: {
    name: string;
    constructorArgs: (Hex | "wnative" | keyof ArtifactsMap)[];
  }[];
}

export interface DynamicContractDeployment {
  type: "dynamic-deployment";
  name: string;
  bytecode: Hex;
  constructorArgs: (Hex | "wnative" | keyof ArtifactsMap)[];
  children?: {
    name: string;
    constructorArgs: (Hex | "wnative" | keyof ArtifactsMap)[];
  }[];
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
