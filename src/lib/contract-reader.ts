import type { Abi, Hex } from "viem";
import type { Metadata } from "./metadata.ts";
import type { StandardInputJSON } from "./standard-input-json.ts";

export interface ContractReader {
  getName(): string;
  getABI(): Abi;
  getBytecode(): Hex;
  getMetadata(): Metadata;
  getStandardInputJSON(): StandardInputJSON;
}
