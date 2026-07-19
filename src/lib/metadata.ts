import type { Abi } from "viem";

export interface Metadata {
  compiler: { version: string };
  language: string;
  output: {
    abi: Abi;
    devdoc?: Record<string, unknown>;
    userdoc?: Record<string, unknown>;
  };
  settings: {
    compilationTarget: Record<string, string>;
    evmVersion: string;
    libraries?: Record<string, string>;
    metadata?: Record<string, unknown>;
    optimizer: { enabled: boolean; runs: number };
    remappings: string[];
  };
  sources: Record<
    string,
    {
      keccak256?: string;
      content?: string;
      urls?: string[];
      license?: string;
    }
  >;
  version: number;
}
