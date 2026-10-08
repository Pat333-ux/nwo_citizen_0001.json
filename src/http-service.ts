import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
  type WellbeingSignal
} from "./wellbeing-pipeline.ts";

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_MAX_BATCH_SIZE = 100;

export interface WellbeingHttpOptions extends PipelineOptions {
  host?: string;
  port?: number;
  maxBodyBytes?: number;
  maxBatchSize?: number;
}

interface ServiceMetrics {
  signals_received: number;
  accepted: number;
  rejected: number;
  critical_opinions: number;
  dao_reviews: number;
  last_processed_at: string | null;
}

class HttpInputError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number
): Promise<unknown> {
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new HttpInputError(413, "Request body exceeds the configured limit");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) {
      throw new HttpInputError(413, "Request body exceeds the configured limit");
    }
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

function validateIngress(
  signal: unknown,
  config: WellbeingRuntimeConfig
): asserts signal is WellbeingSignal {
  if (!isRecord(signal)) throw new HttpInputError(400, "Signal must be a JSON object");
  try {
    validateSignal(
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

function updateMetrics(metrics: ServiceMetrics, envelope: Awaited<ReturnType<typeof processWellbeingSignal>>): void {
  metrics.signals_received += 1;
  if (envelope.routing_decision.status === "accepted") metrics.accepted += 1;
  else metrics.rejected += 1;
  if (envelope.system_opinion.severity === "critical") metrics.critical_opinions += 1;
  if (envelope.audit.dao_review_required) metrics.dao_reviews += 1;
  metrics.last_processed_at = envelope.timestamp;
}

export async function createWellbeingHttpServer(
  options: WellbeingHttpOptions = {}
): Promise<Server> {
  const configDir = resolve(options.configDir ?? process.cwd());
  const runtimeConfig = options.runtimeConfig ?? await loadWellbeingRuntimeConfig(configDir);
  const ledgerDir = resolve(options.ledgerDir ?? join(configDir, ".beast3-ledger"));
  const ledger = new ImmutableFileLedger(ledgerDir);
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new TypeError("Maximum request body size must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new TypeError("Maximum batch size must be a positive safe integer");
  }

  const metrics: ServiceMetrics = {
    signals_received: 0,
    accepted: 0,
    rejected: 0,
    critical_opinions: 0,
    dao_reviews: 0,
    last_processed_at: null
  };
  const processOptions: PipelineOptions = {
    ledgerDir,
    now: options.now,
    runtimeConfig
  };

  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    try {
      if (request.method === "GET" && pathname === "/health") {
        sendJson(response, 200, { status: "ready" });
        return;
      }
      if (request.method === "GET" && pathname === "/metrics") {
        sendJson(response, 200, { ...metrics });
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
          validateIngress(signal, runtimeConfig);
          validSignals.push(signal);
        }
        const envelopes = [];
        for (const signal of validSignals) {
          const envelope = await processWellbeingSignal(signal, processOptions);
          updateMetrics(metrics, envelope);
          envelopes.push(envelope);
        }
        sendJson(response, 200, pathname === "/signals" ? envelopes[0] : { envelopes });
        return;
      }

      const verifyMatch = pathname.match(/^\/ledger\/([a-f0-9]{64})\/verify$/);
      if (request.method === "GET" && verifyMatch) {
        const valid = await ledger.verify(verifyMatch[1]);
        sendJson(response, 200, { deterministic_hash: verifyMatch[1], valid });
        return;
      }
      const recordMatch = pathname.match(/^\/ledger\/([a-f0-9]{64})$/);
      if (request.method === "GET" && recordMatch) {
        const record = await ledger.read(recordMatch[1]);
        if (!record) {
          sendJson(response, 404, { error: "Verified ledger record not found" });
          return;
        }
        sendJson(response, 200, record);
        return;
      }
      if (["/signals", "/signals/batch", "/metrics", "/health"].includes(pathname) ||
        pathname.startsWith("/ledger/")) {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof HttpInputError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: "Request could not be processed" });
    }
  });
}

export async function startWellbeingHttpService(
  options: WellbeingHttpOptions = {}
): Promise<Server> {
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
