import { chmod, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ImmutableFileLedger } from "./wellbeing-pipeline.ts";

export async function replicateAndVerifyLedger(
  sourceDirectory: string,
  replicaDirectory: string
): Promise<{ replicated: number; verified: number }> {
  const sourcePath = resolve(sourceDirectory);
  const replicaPath = resolve(replicaDirectory);
  if (sourcePath === replicaPath) throw new TypeError("Ledger replica must use a different directory");
  const source = new ImmutableFileLedger(sourcePath);
  const replica = new ImmutableFileLedger(replicaPath);
  await mkdir(replicaPath, { recursive: true, mode: 0o700 });
  await chmod(replicaPath, 0o700);
  const names = (await readdir(sourcePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort();
  let replicated = 0;
  for (const name of names) {
    const hash = name.slice(0, -5);
    const record = await source.read(hash);
    if (!record) throw new Error("Primary ledger integrity verification failed");
    const existed = await replica.verify(hash);
    if (!existed) {
      await replica.write(record);
      replicated += 1;
    }
    if (!(await replica.verify(hash))) throw new Error("Replica integrity verification failed");
  }
  const replicaNames = (await readdir(replicaPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
  if (replicaNames.some((name) => !names.includes(name))) {
    throw new Error("Replica contains records absent from the primary ledger");
  }
  return { replicated, verified: names.length };
}

export function startLedgerIntegrityScheduler(
  sourceDirectory: string,
  replicaDirectory: string,
  onError: () => void,
  intervalMs = 15 * 60 * 1000
): () => void {
  const timer = setInterval(() => {
    void replicateAndVerifyLedger(sourceDirectory, replicaDirectory).catch(onError);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
