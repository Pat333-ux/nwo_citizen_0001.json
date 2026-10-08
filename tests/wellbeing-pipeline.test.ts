import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  createWellbeingHttpServer,
  startWellbeingHttpService,
  type WellbeingHttpOptions
} from "../src/http-service.ts";
import { FileSignalQueue } from "../src/file-queue.ts";
import { generateQuarterlyAuditReport } from "../src/quarterly-audit.ts";
import { dispatchAggregateEnvelope, validateOutboundTargets } from "../src/outbound-routing.ts";
import { replicateAndVerifyLedger } from "../src/ledger-replication.ts";
import {
  ImmutableFileLedger,
  applyAuditHooks,
  evaluateOpinion,
  processWellbeingSignal,
  routeSignal,
  validateSignal,
  writeToLedger,
  type DaoAuditHooksConfig,
  type Document84Config,
  type SystemOpinionEngineConfig,
  type SystemLawConstitution,
  type WellbeingSignal
} from "../src/wellbeing-pipeline.ts";

const ledgerDirectories: string[] = [];
const httpServers: Array<Awaited<ReturnType<typeof createWellbeingHttpServer>>> = [];
const fixedTime = new Date("2026-10-08T20:00:00.000Z");

async function makeLedgerDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "beast3-ledger-test-"));
  ledgerDirectories.push(directory);
  return directory;
}

function signal(overrides: Partial<WellbeingSignal> = {}): WellbeingSignal {
  return {
    signal_type: "food_insecurity",
    aggregate_count: 12,
    consent_flag: true,
    contains_personal_identifiers: false,
    aggregate_only: true,
    human_origin: true,
    ...overrides
  };
}

async function loadValidationDocuments(): Promise<
  [SystemLawConstitution, Document84Config, SystemOpinionEngineConfig, DaoAuditHooksConfig]
> {
  const [lawText, documentText, opinionText, hooksText] = await Promise.all([
    readFile(new URL("../system_law_constitution_001.json", import.meta.url), "utf8"),
    readFile(new URL("../munisible_task_force_governance_84.json", import.meta.url), "utf8"),
    readFile(new URL("../system_opinion_engine_001.json", import.meta.url), "utf8"),
    readFile(new URL("../dao_audit_hooks_001.json", import.meta.url), "utf8")
  ]);
  return [
    JSON.parse(lawText),
    JSON.parse(documentText),
    JSON.parse(opinionText),
    JSON.parse(hooksText)
  ];
}

afterEach(async () => {
  await Promise.all(httpServers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }));
  await Promise.all(ledgerDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("processWellbeingSignal", () => {
  it("validates privacy, consent, origin, positive aggregate count, and Document 84 signal types", async () => {
    const [law, doc84] = await loadValidationDocuments();
    const valid = await validateSignal(signal(), law, doc84);
    const noConsent = await validateSignal(signal({ consent_flag: false }), law, doc84);
    const noHumanOrigin = await validateSignal(signal({ human_origin: false }), law, doc84);
    const zeroCount = await validateSignal(signal({ aggregate_count: 0 }), law, doc84);
    const negativeCount = await validateSignal(signal({ aggregate_count: -1 }), law, doc84);
    const unknownType = await validateSignal(signal({ signal_type: "unknown" }), law, doc84);
    const nonAggregate = await validateSignal(signal({ aggregate_only: false }), law, doc84);

    assert.deepEqual(valid, {
      privacy_compliant: true,
      consent_compliant: true,
      aggregate_compliant: true,
      human_origin_verified: true,
      rejection_reason: null
    });

    assert.equal(noConsent.consent_compliant, false);
    assert.equal(noConsent.rejection_reason, "missing_consent");
    assert.equal(noHumanOrigin.consent_compliant, false);
    assert.equal(noHumanOrigin.human_origin_verified, false);
    assert.equal(noHumanOrigin.rejection_reason, "human_origin_unverified");
    assert.equal(zeroCount.aggregate_compliant, false);
    assert.equal(negativeCount.aggregate_compliant, false);
    assert.equal(unknownType.aggregate_compliant, false);
    assert.equal(nonAggregate.privacy_compliant, false);
    assert.equal(nonAggregate.aggregate_compliant, false);
  });

  it("routes from Document 84 rules and leaves rejected review decisions to audit hooks", async () => {
    const [, doc84] = await loadValidationDocuments();
    const invalid: Awaited<ReturnType<typeof validateSignal>> = {
      privacy_compliant: false,
      consent_compliant: true,
      aggregate_compliant: false,
      human_origin_verified: true,
      rejection_reason: "privacy_violation"
    };
    const rejected = routeSignal(signal(), invalid, doc84);
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.primary_service_path, null);
    assert.deepEqual(rejected.secondary_paths, []);
    assert.equal(rejected.dao_review_required, false);
    assert.equal(rejected.escalation_level, "none");

    const valid = routeSignal(
      signal({ signal_type: "medical_support" }),
      {
        privacy_compliant: true,
        consent_compliant: true,
        aggregate_compliant: true,
        human_origin_verified: true,
        rejection_reason: null
      },
      doc84
    );
    assert.equal(valid.primary_service_path, "medical");
    assert.deepEqual(valid.secondary_paths, ["social_services", "community_orgs"]);
  });

  it("exposes opinion evaluation and audit hooks as independent services", async () => {
    const [, , opinionEngine, hooks] = await loadValidationDocuments();
    const result = await processWellbeingSignal(signal({ signal_type: "medical_support" }), {
      ledgerDir: await makeLedgerDirectory(),
      now: () => fixedTime
    });
    const opinion = evaluateOpinion(
      signal({ signal_type: "medical_support" }),
      result.validation,
      result.routing_decision,
      opinionEngine
    );
    assert.equal(opinion.recommended_action, "expand_medical_support");
    assert.deepEqual(opinion.basis.triggered_rules, ["wellbeing_rules", "audit_rules"]);

    const audited = applyAuditHooks(result, hooks);
    assert.equal(audited.audit.dao_review_required, true);
    assert.equal(audited.routing_decision.dao_review_required, true);
    assert.ok(audited.audit.triggered_hooks.includes("critical_opinion_hook"));

    const finalized = writeToLedger(audited);
    assert.equal(finalized.deterministic_hash, result.deterministic_hash);
    assert.equal(finalized.envelope_id, result.envelope_id);
  });

  it("routes a valid aggregate signal and stores only a hashed, immutable envelope", async () => {
    const ledgerDir = await makeLedgerDirectory();
    const result = await processWellbeingSignal(signal(), { ledgerDir, now: () => fixedTime });
    const entries = await readdir(ledgerDir);

    assert.equal(result.routing_decision.status, "accepted");
    assert.equal(result.routing_decision.primary_service_path, "food");
    assert.deepEqual(result.routing_decision.secondary_paths, ["shelter", "community_orgs"]);
    assert.deepEqual(result.routing_decision.layer_propagation, ["municipal", "county"]);
    assert.equal(result.system_opinion.recommended_action, "increase_food_support");
    assert.equal(result.audit.dao_review_required, false);
    assert.equal(result.ledger_anchor.category, "community_wellbeing");
    assert.match(result.deterministic_hash, /^[a-f0-9]{64}$/);
    assert.equal(result.envelope_id, `sha256:${result.deterministic_hash}`);
    assert.deepEqual(entries, [`${result.deterministic_hash}.json`]);
    assert.equal(JSON.parse(await readFile(join(ledgerDir, entries[0]), "utf8")).deterministic_hash, result.deterministic_hash);
    assert.equal(await new ImmutableFileLedger(ledgerDir).verify(result.deterministic_hash), true);
    assert.deepEqual(Object.keys(result.input_signal).sort(), ["aggregate_count", "signal_type"]);
  });

  it("rejects personal data, omits the contribution count, and schedules DAO review", async () => {
    const ledgerDir = await makeLedgerDirectory();
    const result = await processWellbeingSignal(
      signal({ contains_personal_identifiers: true }),
      { ledgerDir, now: () => fixedTime }
    );

    assert.equal(result.validation.rejection_reason, "privacy_violation");
    assert.equal(result.routing_decision.status, "rejected");
    assert.equal(result.routing_decision.primary_service_path, null);
    assert.equal(result.input_signal.aggregate_count, undefined);
    assert.equal(result.ledger_anchor.flags.privacy_violation, true);
    assert.equal(result.audit.dao_review_required, true);
    assert.ok(result.audit.triggered_hooks.includes("privacy_violation_hook"));
    const stored = await readFile(join(ledgerDir, `${result.deterministic_hash}.json`), "utf8");
    assert.equal(stored.includes("aggregate_count"), false);
    assert.equal(stored.includes("contains_personal_identifiers"), false);
  });

  it("rejects missing consent before the low aggregate-count failure", async () => {
    const ledgerDir = await makeLedgerDirectory();
    const result = await processWellbeingSignal(
      signal({ signal_type: "medical_support", aggregate_count: 5, consent_flag: false }),
      { ledgerDir, now: () => fixedTime }
    );

    assert.equal(result.validation.rejection_reason, "missing_consent");
    assert.equal(result.validation.aggregate_compliant, false);
    assert.equal(result.ledger_anchor.flags.consent_missing, true);
    assert.equal(result.input_signal.aggregate_count, undefined);
    assert.ok(result.audit.triggered_hooks.includes("consent_violation_hook"));
    assert.equal(result.system_opinion.severity, "critical");
  });

  it("rejects below-threshold aggregates without persisting their count", async () => {
    const ledgerDir = await makeLedgerDirectory();
    const result = await processWellbeingSignal(
      signal({ aggregate_count: 9 }),
      { ledgerDir, now: () => fixedTime }
    );

    assert.equal(result.validation.rejection_reason, "insufficient_aggregate_count");
    assert.equal(result.input_signal.aggregate_count, undefined);
    assert.equal(result.ledger_anchor.category, "rejected_payload");
  });

  it("rejects unsupported signals without retaining their supplied type", async () => {
    const ledgerDir = await makeLedgerDirectory();
    const result = await processWellbeingSignal(
      signal({ signal_type: "unexpected-private-value" }),
      { ledgerDir, now: () => fixedTime }
    );

    assert.equal(result.validation.rejection_reason, "unsupported_signal_type");
    assert.equal(result.input_signal.signal_type, "unclassified");
    assert.equal(result.routing_decision.status, "rejected");
  });

  it("rejects non-aggregate input and unexpected personal-data fields", async () => {
    const ledgerDir = await makeLedgerDirectory();
    const raw = {
      ...signal({ aggregate_only: false }),
      contact_detail: "must-not-be-persisted"
    } as WellbeingSignal;
    const result = await processWellbeingSignal(raw, { ledgerDir, now: () => fixedTime });
    const stored = await readFile(join(ledgerDir, `${result.deterministic_hash}.json`), "utf8");

    assert.equal(result.validation.rejection_reason, "privacy_violation");
    assert.equal(result.validation.aggregate_compliant, false);
    assert.equal(result.ledger_anchor.flags.privacy_violation, true);
    assert.equal(result.input_signal.aggregate_count, undefined);
    assert.equal(stored.includes("contact_detail"), false);
    assert.equal(stored.includes("must-not-be-persisted"), false);
    assert.ok(result.audit.triggered_hooks.includes("aggregate_violation_hook"));

    const nonAggregateResult = await processWellbeingSignal(
      signal({ aggregate_only: false }),
      { ledgerDir, now: () => fixedTime }
    );
    assert.equal(nonAggregateResult.validation.rejection_reason, "privacy_violation");
  });

  it("escalates critical medical opinions through state, federal, and DAO review", async () => {
    const ledgerDir = await makeLedgerDirectory();
    const result = await processWellbeingSignal(
      signal({ signal_type: "medical_support" }),
      { ledgerDir, now: () => fixedTime }
    );

    assert.equal(result.system_opinion.severity, "critical");
    assert.equal(result.system_opinion.recommended_action, "expand_medical_support");
    assert.deepEqual(result.routing_decision.layer_propagation, [
      "municipal",
      "county",
      "state",
      "federal",
      "dao"
    ]);
    assert.ok(result.audit.triggered_hooks.includes("critical_opinion_hook"));
    assert.equal(result.routing_decision.escalation_level, "dao");
  });

  it("produces a repeatable hash and makes duplicate ledger writes idempotent", async () => {
    const ledgerDir = await makeLedgerDirectory();
    const first = await processWellbeingSignal(signal(), { ledgerDir, now: () => fixedTime });
    const second = await processWellbeingSignal(signal(), { ledgerDir, now: () => fixedTime });

    assert.equal(first.deterministic_hash, second.deterministic_hash);
    assert.deepEqual(await readdir(ledgerDir), [`${first.deterministic_hash}.json`]);
  });

  it("detects ledger record alteration when verifying its content hash", async () => {
    const ledgerDir = await makeLedgerDirectory();
    const result = await processWellbeingSignal(signal(), { ledgerDir, now: () => fixedTime });
    const recordPath = join(ledgerDir, `${result.deterministic_hash}.json`);
    await chmod(recordPath, 0o600);
    await writeFile(recordPath, "{}", "utf8");

    assert.equal(await new ImmutableFileLedger(ledgerDir).verify(result.deterministic_hash), false);
  });

  it("rejects malformed runtime inputs before envelope construction", async () => {
    const ledgerDir = await makeLedgerDirectory();
    await assert.rejects(
      processWellbeingSignal(signal({ aggregate_count: Number.NaN }), { ledgerDir }),
      /WellbeingSignal contract/
    );
    assert.deepEqual(await readdir(ledgerDir), []);
  });
});

describe("wellbeing HTTP service", () => {
  async function startService(options: Partial<WellbeingHttpOptions> = {}) {
    const ledgerDir = await makeLedgerDirectory();
    const apiKey = options.apiKey ?? "test-service-key";
    const server = await startWellbeingHttpService({
      configDir: process.cwd(),
      ledgerDir,
      queueDir: join(ledgerDir, "queue"),
      auditReportDir: join(ledgerDir, "reports"),
      host: "127.0.0.1",
      port: 0,
      now: () => fixedTime,
      apiKey,
      ...options
    });
    httpServers.push(server);
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      ledgerDir,
      queueDir: join(ledgerDir, "queue"),
      apiKey
    };
  }

  async function waitForJob(baseUrl: string, id: string, apiKey = "test-service-key") {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await fetch(`${baseUrl}/jobs/${id}`, {
        headers: { authorization: "Bearer " + apiKey }
      });
      const result = await response.json() as {
        id: string;
        status: string;
        deterministic_hash?: string;
        outbound_deliveries?: unknown[];
      };
      if (result.status === "completed" || result.status === "failed") return result;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for queue worker");
  }

  it("ingests signals, returns only redacted envelopes, and supports verified ledger retrieval", async () => {
    const { baseUrl, apiKey } = await startService();
    const response = await fetch(`${baseUrl}/signals`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify(signal())
    });
    const job = await response.json() as { id: string; status: string };
    assert.equal(response.status, 202);
    assert.equal(job.status, "queued");
    const completed = await waitForJob(baseUrl, job.id, apiKey);
    assert.equal(completed.status, "completed");
    assert.ok(completed.deterministic_hash);
    const recordResponse = await fetch(`${baseUrl}/ledger/${completed.deterministic_hash}`, {
      headers: { authorization: "Bearer " + apiKey }
    });
    const envelope = await recordResponse.json() as Awaited<ReturnType<typeof processWellbeingSignal>>;
    assert.deepEqual(Object.keys(envelope.input_signal).sort(), ["aggregate_count", "signal_type"]);
    assert.equal(recordResponse.status, 200);
    assert.equal(envelope.deterministic_hash, completed.deterministic_hash);
    const verification = await fetch(`${baseUrl}/ledger/${envelope.deterministic_hash}/verify`, {
      headers: { authorization: "Bearer " + apiKey }
    });
    assert.deepEqual(await verification.json(), {
      deterministic_hash: envelope.deterministic_hash,
      valid: true
    });
    const metrics = await (await fetch(`${baseUrl}/metrics`, {
      headers: { authorization: "Bearer " + apiKey }
    })).json() as Record<string, any>;
    assert.equal(metrics.signals_received, 1);
    assert.equal(metrics.accepted, 1);
    assert.equal(metrics.rejected, 0);
    assert.equal(metrics.last_processed_at, fixedTime.toISOString());
    for (const stage of ["validation", "routing", "opinion", "audit", "ledger"]) {
      assert.equal(metrics.stage_timings_ms[stage].count, 1);
    }
    assert.equal(metrics.opinion_rules.wellbeing_rules, 1);
  });

  it("prevalidates a batch before processing and processes valid batches in order", async () => {
    const { baseUrl, queueDir, apiKey } = await startService({ maxBatchSize: 3 });
    const malformed = await fetch(`${baseUrl}/signals/batch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify([signal(), { ...signal(), aggregate_count: "12" }])
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await readdir(queueDir), [".worker.lock", "completed", "pending", "processing"]);
    assert.deepEqual(await readdir(join(queueDir, "pending")), []);

    const batch = await fetch(`${baseUrl}/signals/batch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify([
        signal(),
        signal({ consent_flag: false, signal_type: "shelter_need" })
      ])
    });
    const { jobs } = await batch.json() as {
      jobs: Array<{ id: string; status: string }>;
    };
    assert.equal(batch.status, 202);
    const completed = await Promise.all(jobs.map((job) => waitForJob(baseUrl, job.id, apiKey)));
    assert.deepEqual(completed.map((job) => job.status), ["completed", "completed"]);
    const metrics = await (await fetch(`${baseUrl}/metrics`, {
      headers: { authorization: "Bearer " + apiKey }
    })).json() as Record<string, any>;
    assert.equal(metrics.signals_received, 2);
    assert.equal(metrics.accepted, 1);
    assert.equal(metrics.rejected, 1);
    assert.equal(metrics.dao_reviews, 1);
    assert.equal(metrics.validation_rejections.missing_consent, 1);
    assert.equal(metrics.stage_timings_ms.validation.count, 2);
  });

  it("bounds request sizes and returns safe client errors", async () => {
    const { baseUrl, apiKey } = await startService({ maxBodyBytes: 20 });
    const oversized = await fetch(`${baseUrl}/signals`, {
      method: "POST",
      headers: { authorization: "Bearer " + apiKey },
      body: JSON.stringify(signal())
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), {
      error: "Request body exceeds the configured limit"
    });
    const missing = await fetch(`${baseUrl}/ledger/${"a".repeat(64)}`, {
      headers: { authorization: "Bearer " + apiKey }
    });
    assert.equal(missing.status, 404);
  });

  it("requires API keys for protected endpoints and applies per-client rate limits", async () => {
    const apiKey = "test-service-key";
    const { baseUrl } = await startService({
      apiKey,
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 60_000
    });
    assert.equal((await fetch(`${baseUrl}/metrics`)).status, 401);
    const authorized = await fetch(`${baseUrl}/metrics`, {
      headers: { authorization: "Bearer " + apiKey }
    });
    assert.equal(authorized.status, 200);
    const limited = await fetch(`${baseUrl}/metrics`, {
      headers: { authorization: "Bearer " + apiKey }
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    await assert.rejects(
      createWellbeingHttpServer({ configDir: process.cwd(), host: "0.0.0.0" }),
      /BEAST3_API_KEY is required/
    );
  });

  it("returns backpressure when the durable queue reaches capacity", async () => {
    const { baseUrl, apiKey } = await startService({
      maxQueueSize: 1,
      workerPollIntervalMs: 10_000
    });
    const post = () => fetch(`${baseUrl}/signals`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify(signal())
    });
    assert.equal((await post()).status, 202);
    const full = await post();
    assert.equal(full.status, 503);
    assert.equal(full.headers.get("retry-after"), "1");
  });

  it("redacts rejected queue payloads before they are persisted", async () => {
    const { baseUrl, queueDir, apiKey } = await startService({ workerPollIntervalMs: 10_000 });
    const response = await fetch(`${baseUrl}/signals/batch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify([
        signal({ aggregate_count: 9 }),
        signal({ signal_type: "unrecognized-sensitive-category" })
      ])
    });
    assert.equal(response.status, 202);
    const queued = await Promise.all((await readdir(join(queueDir, "pending"))).map(async (name) =>
      JSON.parse(await readFile(join(queueDir, "pending", name), "utf8")).signal as WellbeingSignal
    ));
    assert.ok(queued.some((job) => job.aggregate_count === 0));
    assert.ok(queued.some((job) => job.signal_type === "unclassified"));
    for (const job of queued) {
      assert.equal("contact_detail" in job, false);
      assert.equal("personal_identifier" in job, false);
    }
  });

  it("prevents multiple service workers from consuming one file queue concurrently", async () => {
    const { queueDir } = await startService();
    await assert.rejects(
      createWellbeingHttpServer({
        configDir: process.cwd(),
        ledgerDir: await makeLedgerDirectory(),
        queueDir,
        apiKey: "test-service-key"
      }),
      /Another queue worker is already active/
    );
  });
});

describe("durable queue, audit reports, routing adapters, and replication", () => {
  it("recovers queued jobs and stores only the declared signal fields", async () => {
    const directory = await makeLedgerDirectory();
    const queue = new FileSignalQueue(directory);
    const queued = await queue.enqueue({ ...signal(), contact_detail: "drop-this" } as WellbeingSignal);
    const restarted = new FileSignalQueue(directory);
    const job = await restarted.claim();
    assert.ok(job);
    assert.equal(job.id, queued.id);
    assert.equal("contact_detail" in job.signal, false);
    assert.deepEqual(Object.keys(job.signal).sort(), [
      "aggregate_count",
      "aggregate_only",
      "consent_flag",
      "contains_personal_identifiers",
      "human_origin",
      "signal_type"
    ]);
    await restarted.fail(job);
    assert.deepEqual(await restarted.get(job.id), {
      id: job.id,
      status: "failed",
      error_code: "processing_failed"
    });
  });

  it("generates quarterly reports from verified review-required ledger envelopes", async () => {
    const ledgerDirectory = await makeLedgerDirectory();
    const reportDirectory = join(ledgerDirectory, "reports");
    await processWellbeingSignal(signal({ signal_type: "medical_support" }), {
      ledgerDir: ledgerDirectory,
      now: () => fixedTime
    });
    const report = await generateQuarterlyAuditReport(
      ledgerDirectory,
      reportDirectory,
      "2026-Q4",
      fixedTime
    );
    assert.equal(report.reviewed_envelopes, 1);
    assert.equal(report.counts_by_signal_type.medical_support, 1);
    assert.equal(report.severity_distribution.critical, 1);
    assert.ok(report.routing_paths.federal >= 1);
    assert.ok(report.escalations.dao >= 1);
    assert.match(await readFile(join(reportDirectory, "dao-audit-2026-Q4.md"), "utf8"), /LUCR stability impact/);
    assert.deepEqual(
      await generateQuarterlyAuditReport(ledgerDirectory, reportDirectory, "2026-Q4", new Date("2026-10-09T20:00:00.000Z")),
      report
    );
  });

  it("sends only aggregate fields to configured HTTPS targets and records deterministic failures", async () => {
    const ledgerDirectory = await makeLedgerDirectory();
    const envelope = await processWellbeingSignal(signal({ signal_type: "medical_support" }), {
      ledgerDir: ledgerDirectory,
      now: () => fixedTime
    });
    const bodies: string[] = [];
    const idempotencyKeys: string[] = [];
    const deliveries = await dispatchAggregateEnvelope(
      envelope,
      { medical: "https://agency.example/intake" },
      100,
      async (_url, init) => {
        bodies.push(String(init?.body));
        idempotencyKeys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
        return new Response(null, { status: 503 });
      },
      "job-123"
    );
    assert.deepEqual(deliveries, [{
      service_path: "medical",
      status: "failed",
      error_code: "http_error"
    }]);
    assert.deepEqual(JSON.parse(bodies[0]), {
      signal_type: "medical_support",
      aggregate_count: 12,
      service_path: "medical",
      escalation_level: "dao"
    });
    assert.equal(bodies[0].includes("consent_flag"), false);
    assert.deepEqual(idempotencyKeys, ["job-123"]);
    assert.throws(() => validateOutboundTargets({ medical: "http://agency.example/intake" }), /HTTPS/);
  });

  it("replicates and re-verifies hash-addressed envelopes in a second store", async () => {
    const ledgerDirectory = await makeLedgerDirectory();
    const replicaDirectory = join(ledgerDirectory, "replica");
    const envelope = await processWellbeingSignal(signal(), {
      ledgerDir: ledgerDirectory,
      replicaDir: replicaDirectory,
      now: () => fixedTime
    });
    assert.equal(await new ImmutableFileLedger(replicaDirectory).verify(envelope.deterministic_hash), true);
    assert.deepEqual(
      await replicateAndVerifyLedger(ledgerDirectory, replicaDirectory),
      { replicated: 0, verified: 1 }
    );
  });
});
