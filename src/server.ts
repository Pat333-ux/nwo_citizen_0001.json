import { startWellbeingHttpService } from "./http-service.ts";
import { targetsFromEnvironment } from "./outbound-routing.ts";

const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST ?? "127.0.0.1";
const configDir = process.env.BEAST3_CONFIG_DIR ?? process.cwd();
const ledgerDir = process.env.BEAST3_LEDGER_DIR;
const replicaDir = process.env.BEAST3_REPLICA_DIR;
const queueDir = process.env.BEAST3_QUEUE_DIR;
const auditReportDir = process.env.BEAST3_AUDIT_REPORT_DIR;

try {
  const server = await startWellbeingHttpService({
    host,
    port,
    configDir,
    ledgerDir,
    replicaDir,
    queueDir,
    auditReportDir,
    allowedIps: process.env.BEAST3_ALLOWED_IPS?.split(",").map((ip) => ip.trim()).filter(Boolean),
    rateLimitWindowMs: Number(process.env.BEAST3_RATE_LIMIT_WINDOW_MS ?? "60000"),
    rateLimitMaxRequests: Number(process.env.BEAST3_RATE_LIMIT_MAX_REQUESTS ?? "120"),
    maxQueueSize: Number(process.env.BEAST3_MAX_QUEUE_SIZE ?? "10000"),
    outboundTargets: targetsFromEnvironment()
  });
  console.log(`Beast 3.0 wellbeing service listening on ${host}:${port}`);
  process.on("SIGINT", () => server.close());
  process.on("SIGTERM", () => server.close());
} catch {
  console.error("Beast 3.0 wellbeing service failed to start");
  process.exitCode = 1;
}
