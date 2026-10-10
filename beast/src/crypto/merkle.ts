import { sha256 } from "./hash.ts";

export function merkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return sha256("");
  let level = hashes;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha256(level[i] + (level[i + 1] ?? level[i])));
    }
    level = next;
  }
  return level[0];
}
