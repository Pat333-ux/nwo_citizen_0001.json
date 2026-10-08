import { createHash } from "node:crypto";
import { mkdir, open, readFile, chmod, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface WellbeingSignal {
  signal_type: string;
  aggregate_count: number;
  consent_flag: boolean;
  contains_personal_identifiers: boolean;
  aggregate_only: boolean;
  human_origin: boolean;
  lucr_stability?: string;
}

export interface ValidationResult {
  privacy_compliant: boolean;
  consent_compliant: boolean;
  aggregate_compliant: boolean;
  human_origin_verified: boolean;
  rejection_reason: string | null;
}

export interface SystemLawConstitution {
  privacy_rules: {
    no_personal_identifiers: boolean;
    aggregate_only_required: boolean;
  };
  consent_rules: {
    human_origin_required: boolean;
    explicit_consent_required: boolean;
  };
}

export interface Document84Config {
  allowed_signal_types: string[];
  routing_rules: {
    signal_routes: Record<string, ServiceRoutingRule>;
  };
  privacy_protocols: {
    explicit_consent_required: boolean;
    participation_is_voluntary: boolean;
    personal_identifiers_stored: boolean;
    individual_level_data_entered_into_routing: boolean;
  };
}

export interface ServiceRoutingRule {
  path: string;
  secondary_paths: string[];
  dao_review_required: boolean;
  escalation_level: RoutingDecision["escalation_level"];
}

export interface RoutingDecision {
  status: "accepted" | "rejected";
  primary_service_path: string | null;
  secondary_paths: string[];
  dao_review_required: boolean;
  escalation_level: "municipal" | "county" | "state" | "federal" | "dao" | "none";
  layer_propagation: string[];
}

export interface SystemOpinion {
  evaluation: string;
  basis: {
    triggered_rules: string[];
    supporting_envelope_fields: string[];
  };
  recommended_action: string | null;
  severity: "info" | "notice" | "warning" | "critical";
  dao_alignment: {
    lucr_stability_impact: "positive" | "neutral" | "negative";
    wellbeing_priority_alignment: boolean;
    audit_required: boolean;
  };
}

export interface RoutingEnvelope {
  envelope_id: string;
  timestamp: string;
  document_anchor: string;
  governance_document_version: string;
  governance_documents: string[];
  input_signal: {
    signal_type: string;
    aggregate_count?: number;
    lucr_stability?: string;
  };
  validation: ValidationResult;
  routing_decision: RoutingDecision;
  system_opinion: SystemOpinion;
  audit: {
    triggered_hooks: string[];
    dao_review_required: boolean;
    audit_cycle: "quarterly";
  };
  ledger_anchor: {
    category: "community_wellbeing" | "rejected_payload";
    governance_document: string;
    audit_cycle: "quarterly";
    flags: {
      privacy_violation: boolean;
      consent_missing: boolean;
      human_origin_missing: boolean;
    };
  };
  deterministic_hash: string;
}

type JsonObject = Record<string, any>;

export interface WellbeingRuntimeConfig {
  law: JsonObject;
  document84: JsonObject;
  router: JsonObject;
  opinionEngine: SystemOpinionEngineConfig;
  auditHooks: DaoAuditHooksConfig;
  document84Filename: string;
  lawFilename: string;
}

interface OpinionRule {
  id: string;
  when: Record<string, unknown>;
  opinion: string;
  recommended_action: string | null;
  basis: string[];
  severity: SystemOpinion["severity"];
  dao_alignment: SystemOpinion["dao_alignment"];
}

export interface SystemOpinionEngineConfig {
  evaluation_rules: OpinionRule[];
}

export interface DaoAuditHooksConfig {
  hooks: Array<{
    id: string;
    when: Record<string, unknown>;
    action: string;
    audit_cycle: "quarterly";
  }>;
}

export interface PipelineOptions {
  configDir?: string;
  ledgerDir?: string;
  now?: () => Date;
  runtimeConfig?: WellbeingRuntimeConfig;
}

export interface LedgerWriter {
  write(envelope: RoutingEnvelope): Promise<RoutingEnvelope>;
}

const DEFAULT_FAILURE_REASON_PRECEDENCE = [
  "privacy_violation",
  "missing_consent",
  "non_aggregate_signal",
  "insufficient_aggregate_count",
  "human_origin_unverified",
  "unsupported_signal_type"
];

async function readJson(filename: string, directory: string): Promise<JsonObject> {
  const contents = await readFile(join(directory, filename), "utf8");
  const parsed: unknown = JSON.parse(contents);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${filename} must contain a JSON object`);
  }
  return parsed as JsonObject;
}

export async function loadWellbeingRuntimeConfig(
  configDir = process.cwd()
): Promise<WellbeingRuntimeConfig> {
  const baseDir = resolve(configDir);
  const routingArtifact = await readJson(
    "nwo_beast3_citizen_0001_assistance_routing_engine_service_path_selection_lucr_stability_priority_governance_alignment_validation_deterministic_core_v1_0_0_alpha_release_candidate.json",
    baseDir
  );
  const routing = routingArtifact.routing;
  if (!routing || typeof routing !== "object") {
    throw new TypeError("Assistance routing artifact is missing its routing object");
  }

  const lawFilename = routing.system_law_constitution;
  const document84Filename = routing.community_wellbeing_governance_document;
  if (typeof lawFilename !== "string" || typeof document84Filename !== "string") {
    throw new TypeError("Routing artifact must reference System Law and Document 84");
  }
  const [law, document84, opinionEngine, auditHooks] = await Promise.all([
    readJson(lawFilename, baseDir),
    readJson(document84Filename, baseDir),
    readJson(routing.system_opinion_engine, baseDir),
    readJson(routing.dao_audit_hooks, baseDir)
  ]);
  if (!Array.isArray(opinionEngine.evaluation_rules) || !Array.isArray(auditHooks.hooks)) {
    throw new TypeError("Opinion rules and DAO audit hooks must be arrays");
  }
  if (
    law.privacy_rules?.no_personal_identifiers !== true ||
    law.privacy_rules?.aggregate_only_required !== true ||
    law.privacy_rules?.location_tracking_prohibited !== true ||
    law.consent_rules?.explicit_consent_required !== true ||
    law.consent_rules?.human_origin_required !== true ||
    law.routing_rules?.reject_on_privacy_violation !== true ||
    law.routing_rules?.reject_on_missing_consent !== true
  ) {
    throw new Error("System Law is missing mandatory privacy, aggregate, or consent safeguards");
  }
  if (
    document84.scope?.individual_records_permitted !== false ||
    document84.scope?.location_tracking_permitted !== false ||
    document84.privacy_protocols?.personal_identifiers_stored !== false ||
    document84.privacy_protocols?.individual_level_data_entered_into_routing !== false ||
    document84.privacy_protocols?.explicit_consent_required !== true ||
    document84.privacy_protocols?.participation_is_voluntary !== true
  ) {
    throw new Error("Document 84 does not prohibit storing personal or individual-level data");
  }
  return {
    law,
    document84,
    router: routing,
    opinionEngine: opinionEngine as SystemOpinionEngineConfig,
    auditHooks: auditHooks as DaoAuditHooksConfig,
    document84Filename,
    lawFilename
  };
}

export async function validateSignal(
  signal: WellbeingSignal,
  law: SystemLawConstitution,
  doc84: Document84Config,
  minimumAggregateCount = 1,
  failureReasonPrecedence = DEFAULT_FAILURE_REASON_PRECEDENCE
): Promise<ValidationResult> {
  if (
    !signal ||
    typeof signal !== "object" ||
    typeof signal.signal_type !== "string" ||
    !Number.isSafeInteger(signal.aggregate_count) ||
    typeof signal.consent_flag !== "boolean" ||
    typeof signal.contains_personal_identifiers !== "boolean" ||
    typeof signal.aggregate_only !== "boolean" ||
    typeof signal.human_origin !== "boolean" ||
    (signal.lucr_stability !== undefined &&
      !["stable", "degrading", "improving"].includes(signal.lucr_stability))
  ) {
    throw new TypeError("Signal does not match the WellbeingSignal contract");
  }
  if (
    !law?.privacy_rules ||
    !law?.consent_rules ||
    !doc84?.privacy_protocols ||
    !Array.isArray(doc84.allowed_signal_types) ||
    !doc84.routing_rules?.signal_routes
  ) {
    throw new TypeError("System Law or Document 84 is missing validation rules");
  }
  if (!Number.isSafeInteger(minimumAggregateCount) || minimumAggregateCount < 1) {
    throw new TypeError("Minimum aggregate count must be a positive safe integer");
  }

  const allowedFields = new Set([
    "signal_type",
    "aggregate_count",
    "consent_flag",
    "contains_personal_identifiers",
    "aggregate_only",
    "human_origin",
    "lucr_stability"
  ]);
  const hasUnexpectedFields = Object.keys(signal).some((field) => !allowedFields.has(field));
  const privacyCompliant =
    (law.privacy_rules.no_personal_identifiers !== true || !signal.contains_personal_identifiers) &&
    (law.privacy_rules.aggregate_only_required !== true || signal.aggregate_only) &&
    !hasUnexpectedFields;
  const humanOriginVerified =
    law.consent_rules.human_origin_required !== true || signal.human_origin;
  const consentCompliant =
    humanOriginVerified &&
    (law.consent_rules.explicit_consent_required !== true || signal.consent_flag);
  const aggregateCompliant =
    signal.aggregate_count > 0 &&
    signal.aggregate_count >= minimumAggregateCount &&
    signal.aggregate_only &&
    doc84.allowed_signal_types.includes(signal.signal_type);
  const reasons = new Set<string>();

  if (!privacyCompliant) reasons.add("privacy_violation");
  if (!consentCompliant) {
    reasons.add(humanOriginVerified ? "missing_consent" : "human_origin_unverified");
  }
  if (!signal.aggregate_only) reasons.add("non_aggregate_signal");
  else if (signal.aggregate_count <= 0 || signal.aggregate_count < minimumAggregateCount) {
    reasons.add("insufficient_aggregate_count");
  }
  if (
    !doc84.allowed_signal_types.includes(signal.signal_type) ||
    !doc84.routing_rules.signal_routes[signal.signal_type]
  ) {
    reasons.add("unsupported_signal_type");
  }

  const rejectionReason =
    failureReasonPrecedence.find((reason) => reasons.has(reason)) ??
    (reasons.has("unsupported_signal_type") ? "unsupported_signal_type" : null);
  return {
    privacy_compliant: privacyCompliant,
    consent_compliant: consentCompliant,
    aggregate_compliant: aggregateCompliant,
    human_origin_verified: humanOriginVerified,
    rejection_reason: rejectionReason
  };
}

export function routeSignal(
  signal: WellbeingSignal,
  validation: ValidationResult,
  doc84: Document84Config
): RoutingDecision {
  if (validation.rejection_reason) {
    return {
      status: "rejected",
      primary_service_path: null,
      secondary_paths: [],
      dao_review_required: false,
      escalation_level: "none",
      layer_propagation: []
    };
  }
  const rule = doc84.routing_rules.signal_routes[signal.signal_type];
  if (!rule) {
    return {
      status: "rejected",
      primary_service_path: null,
      secondary_paths: [],
      dao_review_required: false,
      escalation_level: "none",
      layer_propagation: []
    };
  }
  return {
    status: "accepted",
    primary_service_path: rule.path,
    secondary_paths: rule.secondary_paths ?? [],
    dao_review_required: rule.dao_review_required ?? false,
    escalation_level: rule.escalation_level,
    layer_propagation: ["municipal"]
  };
}

function valueAtPath(context: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as JsonObject)[key];
  }, context);
}

export function ruleMatchesContext(when: JsonObject, context: JsonObject): boolean {
  if (!when || typeof when !== "object") return false;
  return Object.entries(when).every(([key, expected]) => {
    if (key === "aggregate_count_min") {
      const count = valueAtPath(context, "signal.aggregate_count");
      return typeof count === "number" && typeof expected === "number" && count >= expected;
    }
    const candidates = key.includes(".")
      ? [key]
      : [
          `signal.${key}`,
          `validation.${key}`,
          `routing.${key}`,
          `routing.${key.replaceAll("_", ".")}`
        ];
    const value = candidates
      .map((candidate) => valueAtPath(context, candidate))
      .find((candidate) => candidate !== undefined);
    return value === expected;
  });
}

export function evaluateOpinion(
  signal: WellbeingSignal,
  validation: ValidationResult,
  routing: RoutingDecision,
  engine: SystemOpinionEngineConfig
): SystemOpinion {
  const context = { signal, validation, routing };
  const matched = engine.evaluation_rules.find((rule) =>
    ruleMatchesContext(rule.when, context)
  );
  if (!matched) {
    if (validation.rejection_reason) {
      const rejectionBasis: Record<string, string> = {
        missing_consent: "consent_rules",
        non_aggregate_signal: "privacy_rules",
        insufficient_aggregate_count: "privacy_rules",
        human_origin_unverified: "consent_rules",
        unsupported_signal_type: "routing_rules"
      };
      const rejectionField: Record<string, string> = {
        missing_consent: "validation.consent_compliant",
        non_aggregate_signal: "validation.aggregate_compliant",
        insufficient_aggregate_count: "validation.aggregate_compliant",
        human_origin_unverified: "validation.human_origin_verified",
        unsupported_signal_type: "input_signal.signal_type"
      };
      return {
        evaluation: `The signal was rejected: ${validation.rejection_reason}. DAO review is required.`,
        basis: {
          triggered_rules: [rejectionBasis[validation.rejection_reason] ?? "routing_rules", "audit_rules"],
          supporting_envelope_fields: [rejectionField[validation.rejection_reason] ?? "validation.rejection_reason"]
        },
        recommended_action: "flag_for_dao_review",
        severity: "critical",
        dao_alignment: {
          lucr_stability_impact: "neutral",
          wellbeing_priority_alignment: false,
          audit_required: true
        }
      };
    }
    return {
      evaluation: "No configured governance opinion rule was triggered.",
      basis: { triggered_rules: [], supporting_envelope_fields: [] },
      recommended_action: null,
      severity: "notice",
      dao_alignment: {
        lucr_stability_impact: "neutral",
        wellbeing_priority_alignment: false,
        audit_required: false
      }
    };
  }

  return {
    evaluation: matched.opinion,
    basis: {
      triggered_rules: matched.basis,
      supporting_envelope_fields: ["input_signal", "validation", "routing_decision"]
    },
    recommended_action: matched.recommended_action,
    severity: matched.severity,
    dao_alignment: matched.dao_alignment
  };
}

function getPathValue(root: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as JsonObject)[key];
  }, root);
}

export function applyAuditHooks(
  envelope: RoutingEnvelope,
  hooksConfig: DaoAuditHooksConfig
): RoutingEnvelope {
  const hooks = hooksConfig.hooks ?? [];
  const triggeredHooks = hooks
    .filter((hook: JsonObject) =>
      Object.entries(hook.when ?? {}).every(
        ([path, expected]) => getPathValue(envelope as JsonObject, path) === expected
      )
    )
    .map((hook: JsonObject) => hook.id);
  const daoReviewRequired =
    envelope.routing_decision.dao_review_required || triggeredHooks.length > 0;
  return {
    ...envelope,
    routing_decision: {
      ...envelope.routing_decision,
      dao_review_required: daoReviewRequired
    },
    audit: {
      ...envelope.audit,
      triggered_hooks: triggeredHooks,
      dao_review_required: daoReviewRequired
    }
  };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Envelope hashing supports safe integers only");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Unsupported value in deterministic envelope");
}

function envelopeHash(envelope: Omit<RoutingEnvelope, "envelope_id" | "deterministic_hash">): string {
  return createHash("sha256").update(canonicalize(envelope)).digest("hex");
}

export function writeToLedger(
  envelope: Omit<RoutingEnvelope, "envelope_id" | "deterministic_hash">
): RoutingEnvelope {
  const {
    envelope_id: _envelopeId,
    deterministic_hash: _deterministicHash,
    ...envelopeWithoutHashes
  } = envelope as RoutingEnvelope;
  const ledgerAnchor: RoutingEnvelope["ledger_anchor"] = {
    category: envelope.routing_decision.status === "accepted" ? "community_wellbeing" : "rejected_payload",
    governance_document: envelope.document_anchor,
    audit_cycle: "quarterly",
    flags: {
      privacy_violation: !envelope.validation.privacy_compliant,
      consent_missing: !envelope.validation.consent_compliant,
      human_origin_missing: !envelope.validation.human_origin_verified
    }
  };
  const hashable = { ...envelopeWithoutHashes, ledger_anchor: ledgerAnchor };
  const digest = envelopeHash(hashable);
  return {
    ...hashable,
    envelope_id: `sha256:${digest}`,
    deterministic_hash: digest
  };
}

export class ImmutableFileLedger implements LedgerWriter {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async write(envelope: RoutingEnvelope): Promise<RoutingEnvelope> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const destination = join(this.directory, `${envelope.deterministic_hash}.json`);
    const contents = `${JSON.stringify(envelope)}\n`;
    let file;
    try {
      file = await open(destination, "wx", 0o400);
      await file.writeFile(contents, "utf8");
      await file.sync();
      await file.close();
      await chmod(destination, 0o444);
    } catch (error) {
      if (file) await file.close().catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const existing = await readFile(destination, "utf8");
        if (existing !== contents) throw new Error("Ledger hash collision or record alteration detected");
        return envelope;
      }
      await unlink(destination).catch(() => undefined);
      throw error;
    }
    return envelope;
  }

  async verify(deterministicHash: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(deterministicHash)) return false;
    try {
      const record = JSON.parse(
        await readFile(join(this.directory, `${deterministicHash}.json`), "utf8")
      ) as RoutingEnvelope;
      const { envelope_id, deterministic_hash, ...hashable } = record;
      const computed = envelopeHash(hashable);
      return (
        deterministic_hash === deterministicHash &&
        envelope_id === `sha256:${computed}` &&
        computed === deterministicHash
      );
    } catch {
      return false;
    }
  }

  async read(deterministicHash: string): Promise<RoutingEnvelope | null> {
    if (!(await this.verify(deterministicHash))) return null;
    return JSON.parse(
      await readFile(join(this.directory, `${deterministicHash}.json`), "utf8")
    ) as RoutingEnvelope;
  }
}

export async function processWellbeingSignal(
  signal: WellbeingSignal,
  options: PipelineOptions = {}
): Promise<RoutingEnvelope> {
  const configDir = resolve(options.configDir ?? process.cwd());
  const config = options.runtimeConfig ?? await loadWellbeingRuntimeConfig(configDir);
  const validation = await validateSignal(
    signal,
    config.law as SystemLawConstitution,
    config.document84 as Document84Config,
    config.router.validation_layer.minimum_aggregate_count,
    config.router.validation_layer.failure_reason_precedence
  );
  const routingDecision = routeSignal(signal, validation, config.document84 as Document84Config);
  const systemOpinion = evaluateOpinion(
    signal,
    validation,
    routingDecision,
    config.opinionEngine
  );
  const safeInputSignal: RoutingEnvelope["input_signal"] = {
    signal_type: config.document84.routing_rules.signal_routes[signal.signal_type]
      ? signal.signal_type
      : "unclassified"
  };
  if (!validation.rejection_reason) {
    safeInputSignal.aggregate_count = signal.aggregate_count;
    if (signal.lucr_stability) safeInputSignal.lucr_stability = signal.lucr_stability;
  }

  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const baseEnvelope: Omit<RoutingEnvelope, "envelope_id" | "deterministic_hash"> = {
    timestamp,
    document_anchor: config.document84Filename,
    governance_document_version: config.document84.version,
    governance_documents: [config.lawFilename, config.document84Filename],
    input_signal: safeInputSignal,
    validation,
    routing_decision: routingDecision,
    system_opinion: systemOpinion,
    audit: {
      triggered_hooks: [] as string[],
      dao_review_required: routingDecision.dao_review_required,
      audit_cycle: "quarterly" as const
    },
    ledger_anchor: {
      category: routingDecision.status === "accepted" ? "community_wellbeing" : "rejected_payload",
      governance_document: config.document84Filename,
      audit_cycle: "quarterly",
      flags: {
        privacy_violation: !validation.privacy_compliant,
        consent_missing: !validation.consent_compliant,
        human_origin_missing: !validation.human_origin_verified
      }
    }
  };
  const audited = applyAuditHooks(
    { ...baseEnvelope, envelope_id: "", deterministic_hash: "" },
    config.auditHooks
  );

  const layers: RoutingDecision["layer_propagation"] = [];
  if (audited.routing_decision.status === "accepted") {
    layers.push("municipal");
    if (
      systemOpinion.severity === "warning" ||
      systemOpinion.severity === "critical" ||
      audited.audit.dao_review_required
    ) {
      layers.push("county");
    }
    if (audited.audit.triggered_hooks.length > 0) layers.push("state", "federal", "dao");
    audited.routing_decision.layer_propagation = layers;
    audited.routing_decision.escalation_level =
      layers[layers.length - 1] as RoutingDecision["escalation_level"];
  }

  const envelope = writeToLedger(audited);

  const ledger = new ImmutableFileLedger(
    resolve(options.ledgerDir ?? join(configDir, ".beast3-ledger"))
  );
  return ledger.write(envelope);
}
