import { execa } from "execa";
import FoundryReader from "./foundry-reader.ts";
import { gitPull } from "./git.ts";
import { withLock } from "./lock.ts";

interface FoundryBuildOptions {
  commit: string;
  solVersion?: `${number}.${number}.${number}`;
}

export async function foundryBuild(
  url: string,
  options: FoundryBuildOptions,
): Promise<FoundryReader> {
  const { commit, solVersion } = options;
  const { dir } = await gitPull(url, commit);

  // forge writes to out/ and cache/, so two compiles of the same checkout
  // must not run concurrently
  await withLock(
    dir,
    () =>
      execa({
        cwd: dir,
        stdout: ["pipe", "inherit"],
        stderr: "inherit",
      })`forge compile ${solVersion ? ["--use", solVersion] : []}`,
  );

  return new FoundryReader(dir);
}
