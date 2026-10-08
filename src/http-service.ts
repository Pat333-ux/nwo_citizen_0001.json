import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { resolve, join } from "node:path";
import {
  ImmutableFileLedger,
  loadWellbeingRuntimeConfig,
  processWellbeingSignal,
  validateSignal,
  type PipelineOptions,
  type Document84Config,
  type SystemLawConstitution,
  type WellbeingRuntimeConfig,
  type WellbeingSignal,
  type ValidationResult
} from "./wellbeing-pipeline.ts";
import { FileSignalQueue, type QueueResult } from "./file-queue.ts";
import { startQuarterlyAuditScheduler } from "./quarterly-audit.ts";
import {
  dispatchAggregateEnvelope,
  validateOutboundTargets,
  type OutboundTargets
} from "./outbound-routing.ts";
import { replicateAndVerifyLedger, startLedgerIntegrityScheduler } from "./ledger-replication.ts";

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_MAX_BATCH_SIZE = 100;
const DEFAULT_MAX_QUEUE_SIZE = 10_000;
const STAGES = ["validation", "routing", "opinion", "audit", "ledger"] as const;

export interface WellbeingHttpOptions extends PipelineOptions {
  host?: string;
  port?: number;
  maxBodyBytes?: number;
  maxBatchSize?: number;
  maxQueueSize?: number;
  queueDir?: string;
  auditReportDir?: string;
  apiKey?: string;
  allowedIps?: string[];
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
  outboundTargets?: OutboundTargets;
  workerPollIntervalMs?: number;
}

interface ServiceMetrics {
  signals_received: number;
  accepted: number;
  rejected: number;
  critical_opinions: number;
  dao_reviews: number;
  processing_errors: number;
  integrity_errors: number;
  validation_rejections: Record<string, number>;
  opinion_rules: Record<string, number>;
  stage_timings_ms: Record<(typeof STAGES)[number], { count: number; total: number; max: number }>;
  outbound_deliveries: Record<string, { delivered: number; failed: number }>;
  last_processed_at: string | null;
}

class HttpInputError extends Error {
  readonly statusCode: number;
  readonly retryAfter?: number;

  constructor(statusCode: number, message: string, retryAfter?: number) {
    super(message);
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const rawLength = request.headers["content-length"];
  if (rawLength !== undefined && (!/^\d+$/.test(rawLength) || Number(rawLength) > maxBodyBytes)) {
    throw new HttpInputError(413, "Request body exceeds the configured limit");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) throw new HttpInputError(413, "Request body exceeds the configured limit");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpInputError(400, "Request body must be valid JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function validateIngress(signal: unknown, config: WellbeingRuntimeConfig): Promise<ValidationResult> {
  if (!isRecord(signal)) throw new HttpInputError(400, "Signal must be a JSON object");
  try {
    return await validateSignal(
      signal as unknown as WellbeingSignal,
      config.law as unknown as SystemLawConstitution,
      config.document84 as unknown as Document84Config,
      config.router.validation_layer.minimum_aggregate_count,
      config.router.validation_layer.failure_reason_precedence
    );
  } catch {
    throw new HttpInputError(400, "Signal does not match the ingestion contract");
  }
}

function updateMetrics(
  metrics: ServiceMetrics,
  envelope: Awaited<ReturnType<typeof processWellbeingSignal>>,
  deliveries: Awaited<ReturnType<typeof dispatchAggregateEnvelope>>
): void {
  metrics.signals_received += 1;
  if (envelope.routing_decision.status === "accepted") metrics.accepted += 1;
  else metrics.rejected += 1;
  if (envelope.validation.rejection_reason) {
    const reason = envelope.validation.rejection_reason;
    metrics.validation_rejections[reason] = (metrics.validation_rejections[reason] ?? 0) + 1;
  }
  if (envelope.system_opinion.severity === "critical") metrics.critical_opinions += 1;
  if (envelope.audit.dao_review_required) metrics.dao_reviews += 1;
  for (const rule of envelope.system_opinion.basis.triggered_rules) {
    metrics.opinion_rules[rule] = (metrics.opinion_rules[rule] ?? 0) + 1;
  }
  for (const delivery of deliveries) {
    const counts = metrics.outbound_deliveries[delivery.service_path] ?? { delivered: 0, failed: 0 };
    counts[delivery.status] += 1;
    metrics.outbound_deliveries[delivery.service_path] = counts;
  }
  metrics.last_processed_at = envelope.timestamp;
}

function clientAddress(request: IncomingMessage): string {
  const address = request.socket.remoteAddress ?? "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function apiKeyMatches(request: IncomingMessage, expected: string): boolean {
  const authorization = request.headers.authorization ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return false;
  const provided = Buffer.from(authorization.slice(7).trim());
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

function emptyMetrics(): ServiceMetrics {
  return {
    signals_received: 0,
    accepted: 0,
    rejected: 0,
    critical_opinions: 0,
    dao_reviews: 0,
    processing_errors: 0,
    integrity_errors: 0,
    validation_rejections: {},
    opinion_rules: {},
    stage_timings_ms: Object.fromEntries(STAGES.map((stage) => [stage, { count: 0, total: 0, max: 0 }])) as ServiceMetrics["stage_timings_ms"],
    outbound_deliveries: {},
    last_processed_at: null
  };
}

export async function createWellbeingHttpServer(options: WellbeingHttpOptions = {}): Promise<Server> {
  const configDir = resolve(options.configDir ?? process.cwd());
  const runtimeConfig = options.runtimeConfig ?? await loadWellbeingRuntimeConfig(configDir);
  const ledgerDir = resolve(options.ledgerDir ?? join(configDir, ".beast3-ledger"));
  const configuredReplica = options.replicaDir ?? process.env.BEAST3_REPLICA_DIR;
  const replicaDir = configuredReplica ? resolve(configuredReplica) : undefined;
  const queueDir = resolve(options.queueDir ?? process.env.BEAST3_QUEUE_DIR ?? join(configDir, ".beast3-queue"));
  const reportDir = resolve(options.auditReportDir ?? process.env.BEAST3_AUDIT_REPORT_DIR ?? join(configDir, ".beast3-audit"));
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const pollInterval = options.workerPollIntervalMs ?? 100;
  const rateWindow = options.rateLimitWindowMs ?? 60_000;
  const rateLimit = options.rateLimitMaxRequests ?? 120;
  if (![maxBodyBytes, maxBatchSize, maxQueueSize, pollInterval, rateWindow, rateLimit].every(Number.isSafeInteger) ||
      maxBodyBytes < 1 || maxBatchSize < 1 || maxQueueSize < 1 || pollInterval < 1 || rateWindow < 1 || rateLimit < 1) {
    throw new TypeError("HTTP limits and intervals must be positive safe integers");
  }
  const host = options.host ?? "127.0.0.1";
  const apiKey = options.apiKey ?? process.env.BEAST3_API_KEY;
  if (!apiKey) {
    throw new Error("BEAST3_API_KEY is required");
  }
  const allowedIps = new Set(options.allowedIps ?? []);
  for (const ip of allowedIps) {
    if (isIP(ip) === 0) throw new TypeError("IP allowlist entries must be IPv4 or IPv6 addresses");
  }
  const targets = options.outboundTargets ?? {};
  validateOutboundTargets(targets);

  const queue = new FileSignalQueue(queueDir, maxQueueSize);
  await queue.initialize();
  if (replicaDir) await replicateAndVerifyLedger(ledgerDir, replicaDir);
  const releaseQueueWorker = await queue.acquireWorkerLock();
  const ledger = new ImmutableFileLedger(ledgerDir);
  const metrics = emptyMetrics();
  const rateWindows = new Map<string, { startedAt: number; count: number }>();
  let workerStopped = false;
  let workerTimer: ReturnType<typeof setTimeout>;
  let workerRunning = false;
  const processOptions: PipelineOptions = {
    ledgerDir,
    replicaDir,
    now: options.now,
    runtimeConfig,
    onStageTiming(stage, durationMs) {
      const item = metrics.stage_timings_ms[stage];
      item.count += 1;
      item.total += durationMs;
      item.max = Math.max(item.max, durationMs);
    }
  };
  const stopIntegrityScheduler = replicaDir
    ? startLedgerIntegrityScheduler(ledgerDir, replicaDir, () => { metrics.integrity_errors += 1; })
    : () => undefined;

  const processOne = async () => {
    if (workerStopped || workerRunning) return;
    workerRunning = true;
    try {
      const job = await queue.claim();
      if (!job) return;
      try {
        const envelope = await processWellbeingSignal(job.signal, processOptions);
        const deliveries = await dispatchAggregateEnvelope(
          envelope,
          targets,
          5_000,
          fetch,
          job.id
        );
        updateMetrics(metrics, envelope, deliveries);
        await queue.complete(job, envelope, deliveries);
      } catch {
        metrics.processing_errors += 1;
        await queue.fail(job).catch(() => undefined);
      }
    } finally {
      workerRunning = false;
      if (!workerStopped) workerTimer = setTimeout(() => void processOne(), pollInterval);
    }
  };
  workerTimer = setTimeout(() => void processOne(), pollInterval);
  workerTimer.unref();
  const stopAuditScheduler = startQuarterlyAuditScheduler(ledgerDir, reportDir, options.now);

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const address = clientAddress(request);
    try {
      if (request.method === "GET" && pathname === "/health") {
        sendJson(response, 200, { status: "ready" });
        return;
      }
      if (allowedIps.size && !allowedIps.has(address)) {
        sendJson(response, 403, { error: "Forbidden" });
        return;
      }
      const nowMs = Date.now();
      const window = rateWindows.get(address);
      if (!window || nowMs - window.startedAt >= rateWindow) {
        rateWindows.set(address, { startedAt: nowMs, count: 1 });
      } else if (window.count >= rateLimit) {
        const retryAfter = Math.max(1, Math.ceil((rateWindow - (nowMs - window.startedAt)) / 1000));
        throw new HttpInputError(429, "Rate limit exceeded", retryAfter);
      } else {
        window.count += 1;
      }
      if (rateWindows.size > 10_000) {
        for (const [ip, item] of rateWindows) {
          if (nowMs - item.startedAt >= rateWindow) rateWindows.delete(ip);
        }
      }
      if (apiKey && !apiKeyMatches(request, apiKey)) {
        sendJson(response, 401, { error: "Unauthorized" }, { "www-authenticate": "Bearer" });
        return;
      }
      if (request.method === "GET" && pathname === "/metrics") {
        sendJson(response, 200, {
          ...metrics,
          stage_timings_ms: Object.fromEntries(Object.entries(metrics.stage_timings_ms).map(([stage, item]) => [
            stage,
            { count: item.count, average: item.count ? item.total / item.count : 0, max: item.max }
          ]))
        });
        return;
      }
      if (request.method === "POST" && (pathname === "/signals" || pathname === "/signals/batch")) {
        const body = await readJsonBody(request, maxBodyBytes);
        const signals = pathname === "/signals/batch" ? body : [body];
        if (!Array.isArray(signals) || signals.length === 0 || signals.length > maxBatchSize) {
          throw new HttpInputError(400, `Batch must contain 1 to ${maxBatchSize} signals`);
        }
        const validSignals: WellbeingSignal[] = [];
          for (const signal of signals) {
            const validation = await validateIngress(signal, runtimeConfig);
            const candidate = signal as WellbeingSignal;
            const rejected = validation.rejection_reason !== null;
            validSignals.push({
              signal_type: runtimeConfig.document84.allowed_signal_types.includes(candidate.signal_type)
                ? candidate.signal_type
                : "unclassified",
              aggregate_count: rejected && validation.rejection_reason !== "unsupported_signal_type"
                ? 0
                : candidate.aggregate_count,
              consent_flag: candidate.consent_flag,
              contains_personal_identifiers: candidate.contains_personal_identifiers,
              aggregate_only: candidate.aggregate_only,
              human_origin: candidate.human_origin,
              ...!rejected && candidate.lucr_stability
                ? { lucr_stability: candidate.lucr_stability }
                : {}
            });
          }
        let results: QueueResult[];
        try {
          results = await queue.enqueueMany(validSignals);
        } catch (error) {
          if ((error as Error).name === "QueueFullError") {
            throw new HttpInputError(503, "Signal queue is full", 1);
          }
          throw error;
        }
        sendJson(response, 202, pathname === "/signals" ? results[0] : { jobs: results });
        return;
      }
      const jobMatch = pathname.match(/^\/jobs\/([a-f0-9-]{36})$/);
      if (request.method === "GET" && jobMatch) {
        const result = await queue.get(jobMatch[1]);
        if (!result) sendJson(response, 404, { error: "Job not found" });
        else sendJson(response, 200, result);
        return;
      }
      const verifyMatch = pathname.match(/^\/ledger\/([a-f0-9]{64})\/verify$/);
      if (request.method === "GET" && verifyMatch) {
        sendJson(response, 200, { deterministic_hash: verifyMatch[1], valid: await ledger.verify(verifyMatch[1]) });
        return;
      }
      const recordMatch = pathname.match(/^\/ledger\/([a-f0-9]{64})$/);
      if (request.method === "GET" && recordMatch) {
        const record = await ledger.read(recordMatch[1]);
        if (!record) sendJson(response, 404, { error: "Verified ledger record not found" });
        else sendJson(response, 200, record);
        return;
      }
      if (["/signals", "/signals/batch", "/metrics", "/health"].includes(pathname) ||
          pathname.startsWith("/ledger/") || pathname.startsWith("/jobs/")) {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof HttpInputError) {
        sendJson(response, error.statusCode, { error: error.message }, error.retryAfter
          ? { "retry-after": String(error.retryAfter) }
          : {});
        return;
      }
      sendJson(response, 500, { error: "Request could not be processed" });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.once("close", () => {
    workerStopped = true;
    clearTimeout(workerTimer);
    stopAuditScheduler();
    stopIntegrityScheduler();
    void (async () => {
      while (workerRunning) await new Promise((resolve) => setTimeout(resolve, 10));
      releaseQueueWorker();
    })();
  });
  return server;
}

export async function startWellbeingHttpService(options: WellbeingHttpOptions = {}): Promise<Server> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError("Port must be an integer from 0 through 65535");
  }
  const server = await createWellbeingHttpServer(options);
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => rejectListen(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolveListen();
    });
  });
  return server;
}
