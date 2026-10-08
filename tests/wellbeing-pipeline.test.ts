import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  ImmutableFileLedger,
  processWellbeingSignal,
  type WellbeingSignal
} from "../src/wellbeing-pipeline.ts";

const ledgerDirectories: string[] = [];
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

afterEach(async () => {
  await Promise.all(ledgerDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("processWellbeingSignal", () => {
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
    assert.equal(nonAggregateResult.validation.rejection_reason, "non_aggregate_signal");
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
      processWellbeingSignal(signal({ aggregate_count: -1 }), { ledgerDir }),
      /WellbeingSignal contract/
    );
    assert.deepEqual(await readdir(ledgerDir), []);
  });
});
