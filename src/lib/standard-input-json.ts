export interface StandardInputJSON {
  language: string;
  sources: Record<string, { content: string }>;
  settings: {
    optimizer: { enabled: boolean; runs: number };
    evmVersion: string;
    remappings?: string[];
    outputSelection: Record<string, Record<string, string[]>>;
  };
}
