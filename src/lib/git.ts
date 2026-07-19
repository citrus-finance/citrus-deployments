import { execa } from "execa";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import path from "path";
import { withLock } from "./lock.ts";

export async function gitPull(url: string, commit: string) {
  // works for both git@host:org/repo.git and https://host/org/repo.git
  const name = url
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .slice(-2)
    .join("/");

  // abbreviated hashes can't be fetched by SHA, so require the full form
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(`Expected a full 40-character commit hash, got "${commit}"`);
  }

  // every checkout of a repo shares the base clone, so git operations on the
  // same repo must not run concurrently
  return withLock(name, async () => {
    const baseDir = `.cache/${name}`;

    await mkdir(".cache", { recursive: true });

    if (!existsSync(baseDir)) {
      console.log(`Cloning ${url}`);
      await execa({
        stdout: "inherit",
        stderr: "inherit",
        cwd: ".cache",
      })`git clone --depth 1 ${url} ${name}`;
    }

    const commitDir = `.cache/${name}@${commit}`;

    // a commit is immutable, so an existing checkout never needs updating
    if (!existsSync(commitDir)) {
      console.log(`Checking out ${url} at ${commit}`);
      await execa({
        stdout: "inherit",
        stderr: "inherit",
        cwd: baseDir,
      })`git fetch --depth 1 origin ${commit}`;

      // drop registrations of worktrees whose directory was deleted manually,
      // otherwise adding one at the same path fails
      await execa({ cwd: baseDir })`git worktree prune`;

      await execa({
        stdout: "inherit",
        stderr: "inherit",
        cwd: baseDir,
      })`git worktree add --detach ${path.resolve(commitDir)} ${commit}`;
    }

    return {
      remoteDir: name,
      dir: commitDir,
      commit,
    };
  });
}
