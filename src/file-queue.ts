import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import type { RoutingEnvelope, WellbeingSignal } from "./wellbeing-pipeline.ts";

export interface QueuedSignal {
  id: string;
  queued_at: string;
  signal: WellbeingSignal;
}

export interface QueueResult {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  deterministic_hash?: string;
  error_code?: "processing_failed";
  outbound_deliveries?: Array<{
    service_path: string;
    status: "delivered" | "failed";
    error_code?: "network_error" | "http_error";
  }>;
}

const SIGNAL_FIELDS = [
  "signal_type",
  "aggregate_count",
  "consent_flag",
  "contains_personal_identifiers",
  "aggregate_only",
  "human_origin",
  "lucr_stability"
] as const;

function sanitizeSignal(signal: WellbeingSignal): WellbeingSignal {
  return Object.fromEntries(
    SIGNAL_FIELDS.filter((field) => signal[field] !== undefined)
      .map((field) => [field, signal[field]])
  ) as unknown as WellbeingSignal;
}

export class FileSignalQueue {
  readonly directory: string;
  readonly maxQueueSize: number;
  readonly pendingDirectory: string;
  readonly processingDirectory: string;
  readonly completedDirectory: string;
  private initialized = false;
  private enqueueSequence = Promise.resolve();

  constructor(
    directory: string,
    maxQueueSize = 10_000
  ) {
    this.directory = directory;
    this.maxQueueSize = maxQueueSize;
    this.pendingDirectory = join(directory, "pending");
    this.processingDirectory = join(directory, "processing");
    this.completedDirectory = join(directory, "completed");
    if (!Number.isSafeInteger(maxQueueSize) || maxQueueSize < 1) {
      throw new TypeError("Maximum queue size must be a positive safe integer");
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await Promise.all([
      mkdir(this.pendingDirectory, { recursive: true, mode: 0o700 }),
      mkdir(this.processingDirectory, { recursive: true, mode: 0o700 }),
      mkdir(this.completedDirectory, { recursive: true, mode: 0o700 })
    ]);
    await Promise.all([
      chmod(this.directory, 0o700),
      chmod(this.pendingDirectory, 0o700),
      chmod(this.processingDirectory, 0o700),
      chmod(this.completedDirectory, 0o700)
    ]);
    this.initialized = true;
  }

  async acquireWorkerLock(): Promise<() => void> {
    await this.initialize();
    const lockPath = join(this.directory, ".worker.lock");
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockData = await readFile(lockPath, "utf8").catch(() => "");
      let ownerPid: number | undefined;
      try {
        ownerPid = (JSON.parse(lockData) as { pid?: number }).pid;
      } catch {
        ownerPid = undefined;
      }
      if (!ownerPid || !Number.isSafeInteger(ownerPid)) {
        throw new Error("Queue worker lock is invalid; manual recovery is required");
      }
      try {
        process.kill(ownerPid, 0);
        throw new Error("Another queue worker is already active");
      } catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code !== "ESRCH") throw probeError;
      }
      await unlink(lockPath);
      return this.acquireWorkerLock();
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid }), "utf8");
      await lock.sync();
      await lock.close();
      await this.syncDirectory(this.directory);
      await this.recoverProcessing();
    } catch (error) {
      await lock.close().catch(() => undefined);
      try {
        unlinkSync(lockPath);
      } catch {}
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      try {
        unlinkSync(lockPath);
      } catch {
        return;
      }
    };
  }

  async recoverProcessing(): Promise<void> {
    await this.initialize();
    for (const [directory, names] of [
      [this.pendingDirectory, await readdir(this.pendingDirectory)],
      [this.completedDirectory, await readdir(this.completedDirectory)]
    ] as const) {
      for (const name of names) {
        if (name.endsWith(".tmp")) await unlink(join(directory, name)).catch(() => undefined);
      }
    }
    for (const name of await readdir(this.processingDirectory)) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
      await rename(join(this.processingDirectory, name), join(this.pendingDirectory, name))
        .catch(() => undefined);
    }
  }

  async enqueue(signal: WellbeingSignal): Promise<QueueResult> {
    return (await this.enqueueMany([signal]))[0];
  }

  async enqueueMany(signals: WellbeingSignal[]): Promise<QueueResult[]> {
    const operation = this.enqueueSequence.then(() => this.writeMany(signals));
    this.enqueueSequence = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async writeMany(signals: WellbeingSignal[]): Promise<QueueResult[]> {
    await this.initialize();
    const [pending, processing] = await Promise.all([
      readdir(this.pendingDirectory),
      readdir(this.processingDirectory)
    ]);
    if (pending.length + processing.length + signals.length > this.maxQueueSize) {
      const error = new Error("Queue capacity reached");
      error.name = "QueueFullError";
      throw error;
    }
    const jobs = signals.map((signal) => ({
      id: randomUUID(),
      queued_at: new Date().toISOString(),
      signal: sanitizeSignal(signal)
    }));
    const created: string[] = [];
    try {
      for (const job of jobs) {
        const temporary = join(this.pendingDirectory, `${job.id}.tmp`);
        const destination = join(this.pendingDirectory, `${job.id}.json`);
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(`${JSON.stringify(job)}\n`, "utf8");
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, destination);
        created.push(destination);
        await this.syncDirectory(this.pendingDirectory);
      }
    } catch (error) {
      await Promise.all([
        ...created.map((filename) => unlink(filename).catch(() => undefined)),
        ...jobs.map(({ id }) => unlink(join(this.pendingDirectory, `${id}.tmp`)).catch(() => undefined))
      ]);
      throw error;
    }
    return jobs.map(({ id }) => ({ id, status: "queued" }));
  }

  async claim(): Promise<QueuedSignal | null> {
    await this.initialize();
    for (const name of (await readdir(this.pendingDirectory)).filter((item) => item.endsWith(".json")).sort()) {
      const source = join(this.pendingDirectory, name);
      const destination = join(this.processingDirectory, name);
      try {
        await rename(source, destination);
        return JSON.parse(await readFile(destination, "utf8")) as QueuedSignal;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }
    return null;
  }

  async complete(
    job: QueuedSignal,
    envelope: RoutingEnvelope,
    outboundDeliveries: QueueResult["outbound_deliveries"] = []
  ): Promise<void> {
    await this.finish(job, {
      id: job.id,
      status: "completed",
      deterministic_hash: envelope.deterministic_hash,
      outbound_deliveries: outboundDeliveries
    });
  }

  async fail(job: QueuedSignal): Promise<void> {
    await this.finish(job, {
      id: job.id,
      status: "failed",
      error_code: "processing_failed"
    });
  }

  async get(id: string): Promise<QueueResult | null> {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    await this.initialize();
    const completed = join(this.completedDirectory, `${id}.json`);
    try {
      return JSON.parse(await readFile(completed, "utf8")) as QueueResult;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const state of ["pending", "processing"]) {
      try {
        await stat(join(this.directory, state, `${id}.json`));
        return { id, status: state === "pending" ? "queued" : "processing" };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return null;
  }

  private async finish(job: QueuedSignal, result: QueueResult): Promise<void> {
    const destination = join(this.completedDirectory, `${job.id}.json`);
    const temporary = join(this.completedDirectory, `${job.id}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(result)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
    await this.syncDirectory(this.completedDirectory);
    await unlink(join(this.processingDirectory, `${job.id}.json`));
    await this.syncDirectory(this.processingDirectory);
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
