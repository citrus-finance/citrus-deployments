import { mkdir, writeFile } from "fs/promises";
import path from "path";

const OUTPUT_DIR = "public";

export async function writeOutput(filePath: string, content: string) {
  const target = path.join(OUTPUT_DIR, filePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

export async function writeJSONOutput(filePath: string, content: any) {
  if (!filePath.endsWith(".json")) {
    throw new Error(`Expected a .json file path, got "${filePath}"`);
  }
  const minFilePath = filePath.replace(/\.json$/, ".min.json");
  await Promise.all([
    writeOutput(filePath, JSON.stringify(content, null, 2)),
    writeOutput(minFilePath, JSON.stringify(content)),
  ]);
}
