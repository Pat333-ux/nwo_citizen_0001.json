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

interface GovernanceConfig {
  law: JsonObject;
  document84: JsonObject;
  router: JsonObject;
  opinionEngine: JsonObject;
  auditHooks: JsonObject;
  opinionRules: OpinionRule[];
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

interface PipelineOptions {
  configDir?: string;
  ledgerDir?: string;
  now?: () => Date;
}

export interface LedgerWriter {
  write(envelope: RoutingEnvelope): Promise<RoutingEnvelope>;
}

const SERVICE_BY_SIGNAL: Record<string, string> = {
  food_insecurity: "food",
  shelter_need: "shelter",
  housing_need: "shelter",
  medical_support: "medical",
  social_services: "social_services",
  community_need: "community_orgs",
  resource_gap: "community_orgs",
  municipal_hazard: "municipal_services",
  infrastructure_condition: "municipal_services",
  service_availability: "municipal_services"
};

const SECONDARY_SERVICES: Record<string, string[]> = {
  food: ["shelter", "community_orgs"],
  shelter: ["food", "community_orgs"],
  medical: ["social_services", "community_orgs"],
  social_services: ["community_orgs", "food"],
  community_orgs: ["social_services", "shelter"],
  municipal_services: ["social_services", "community_orgs"]
};

const SEVERITY_RANK: Record<SystemOpinion["severity"], number> = {
  info: 0,
  notice: 1,
  warning: 2,
  critical: 3
};

async function readJson(filename: string, directory: string): Promise<JsonObject> {
  const contents = await readFile(join(directory, filename), "utf8");
  const parsed: unknown = JSON.parse(contents);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${filename} must contain a JSON object`);
  }
  return parsed as JsonObject;
}

async function loadGovernanceConfig(configDir: string): Promise<GovernanceConfig> {
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
    opinionEngine,
    auditHooks,
    opinionRules: opinionEngine.evaluation_rules as OpinionRule[],
    document84Filename,
    lawFilename
  };
}

function validateSignal(signal: WellbeingSignal, config: GovernanceConfig): ValidationResult {
  if (
    !signal ||
    typeof signal !== "object" ||
    typeof signal.signal_type !== "string" ||
    !Number.isSafeInteger(signal.aggregate_count) ||
    signal.aggregate_count < 0 ||
    typeof signal.consent_flag !== "boolean" ||
    typeof signal.contains_personal_identifiers !== "boolean" ||
    typeof signal.aggregate_only !== "boolean" ||
    typeof signal.human_origin !== "boolean" ||
    (signal.lucr_stability !== undefined &&
      !["stable", "degrading", "improving"].includes(signal.lucr_stability))
  ) {
    throw new TypeError("Signal does not match the WellbeingSignal contract");
  }

  const minimumCount = config.router.validation_layer.minimum_aggregate_count;
  if (!Number.isSafeInteger(minimumCount) || minimumCount < 1) {
    throw new TypeError("Routing config must define a positive minimum aggregate count");
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
  const privacyCompliant = !signal.contains_personal_identifiers && !hasUnexpectedFields;
  const consentCompliant = signal.consent_flag;
  const aggregateCompliant = signal.aggregate_only && signal.aggregate_count >= minimumCount;
  const humanOriginVerified = signal.human_origin;
  const reasons = new Set<string>();

  if (!privacyCompliant) reasons.add("privacy_violation");
  if (!consentCompliant) reasons.add("missing_consent");
  if (!signal.aggregate_only) reasons.add("non_aggregate_signal");
  else if (signal.aggregate_count < minimumCount) reasons.add("insufficient_aggregate_count");
  if (!humanOriginVerified) reasons.add("human_origin_unverified");
  if (!SERVICE_BY_SIGNAL[signal.signal_type]) reasons.add("unsupported_signal_type");

  const precedence: string[] = config.router.validation_layer.failure_reason_precedence;
  const rejectionReason =
    precedence.find((reason) => reasons.has(reason)) ??
    (reasons.has("unsupported_signal_type") ? "unsupported_signal_type" : null);
  return {
    privacy_compliant: privacyCompliant,
    consent_compliant: consentCompliant,
    aggregate_compliant: aggregateCompliant,
    human_origin_verified: humanOriginVerified,
    rejection_reason: rejectionReason
  };
}

function routeSignal(
  signal: WellbeingSignal,
  validation: ValidationResult,
  config: GovernanceConfig
): RoutingDecision {
  if (validation.rejection_reason) {
    return {
      status: "rejected",
      primary_service_path: null,
      secondary_paths: [],
      dao_review_required: true,
      escalation_level: "none",
      layer_propagation: []
    };
  }
  const primary = SERVICE_BY_SIGNAL[signal.signal_type];
  if (!primary) {
    return {
      status: "rejected",
      primary_service_path: null,
      secondary_paths: [],
      dao_review_required: true,
      escalation_level: "none",
      layer_propagation: []
    };
  }
  const priorities: string[] = config.router.preferred_service_path_for_wellbeing_signals;
  const configuredSecondaries = SECONDARY_SERVICES[primary] ?? [];
  const secondaries = configuredSecondaries
    .filter((service) => priorities.includes(service) && service !== primary)
    .slice(0, 2);
  return {
    status: "accepted",
    primary_service_path: primary,
    secondary_paths: secondaries,
    dao_review_required: false,
    escalation_level: "municipal",
    layer_propagation: ["municipal"]
  };
}

function ruleMatches(rule: JsonObject, signal: WellbeingSignal, validation: ValidationResult): boolean {
  const conditions = rule.when;
  if (!conditions || typeof conditions !== "object") return false;
  return Object.entries(conditions).every(([key, expected]) => {
    if (key === "signal_type") return signal.signal_type === expected;
    if (key === "aggregate_count_min") {
      return typeof expected === "number" && signal.aggregate_count >= expected;
    }
    if (key === "privacy_compliant") return validation.privacy_compliant === expected;
    if (key === "consent_compliant") return validation.consent_compliant === expected;
    if (key === "aggregate_compliant") return validation.aggregate_compliant === expected;
    if (key === "human_origin_verified") return validation.human_origin_verified === expected;
    if (key === "lucr_stability") return signal.lucr_stability === expected;
    return false;
  });
}

function evaluateOpinion(
  signal: WellbeingSignal,
  validation: ValidationResult,
  config: GovernanceConfig
): SystemOpinion {
  const matches = config.opinionRules.filter((rule) => {
    if (
      validation.rejection_reason &&
      !["privacy_violation_review"].includes(rule.id)
    ) {
      return false;
    }
    return ruleMatches(rule, signal, validation);
  });
  if (matches.length === 0) {
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

  const severity = matches.reduce<SystemOpinion["severity"]>(
    (highest: SystemOpinion["severity"], rule: OpinionRule) =>
      SEVERITY_RANK[rule.severity as SystemOpinion["severity"]] > SEVERITY_RANK[highest]
        ? rule.severity
        : highest,
    "info"
  );
  const basisFields = new Set<string>();
  for (const rule of matches) {
    for (const [key] of Object.entries(rule.when)) {
      if (key === "signal_type" || key === "aggregate_count_min") {
        basisFields.add("input_signal." + (key === "aggregate_count_min" ? "aggregate_count" : key));
      } else {
        basisFields.add("validation." + key);
      }
    }
  }
  return {
    evaluation: matches.map((rule) => rule.opinion).join(" "),
    basis: {
      triggered_rules: matches.map((rule) => rule.id),
      supporting_envelope_fields: [...basisFields]
    },
    recommended_action: matches[0].recommended_action,
    severity,
    dao_alignment: {
      lucr_stability_impact: matches.some((rule) =>
        rule.dao_alignment?.lucr_stability_impact === "positive"
      )
        ? "positive"
        : "neutral",
      wellbeing_priority_alignment: matches.some(
        (rule) => rule.dao_alignment?.wellbeing_priority_alignment === true
      ),
      audit_required: matches.some((rule) => rule.dao_alignment?.audit_required === true)
    }
  };
}

function getPathValue(root: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as JsonObject)[key];
  }, root);
}

function applyAuditHooks(
  envelope: JsonObject,
  auditHooks: JsonObject
): { triggeredHooks: string[]; daoReviewRequired: boolean } {
  const hooks = auditHooks.hooks ?? [];
  const triggeredHooks = hooks
    .filter((hook: JsonObject) =>
      Object.entries(hook.when ?? {}).every(
        ([path, expected]) => getPathValue(envelope as JsonObject, path) === expected
      )
    )
    .map((hook: JsonObject) => hook.id);
  return {
    triggeredHooks,
    daoReviewRequired: triggeredHooks.length > 0 || envelope.routing_decision.status === "rejected"
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
}

export async function processWellbeingSignal(
  signal: WellbeingSignal,
  options: PipelineOptions = {}
): Promise<RoutingEnvelope> {
  const configDir = resolve(options.configDir ?? process.cwd());
  const config = await loadGovernanceConfig(configDir);
  const validation = validateSignal(signal, config);
  const routingDecision = routeSignal(signal, validation, config);
  const systemOpinion = evaluateOpinion(signal, validation, config);
  const safeInputSignal: RoutingEnvelope["input_signal"] = {
    signal_type: SERVICE_BY_SIGNAL[signal.signal_type] ? signal.signal_type : "unclassified"
  };
  if (!validation.rejection_reason) {
    safeInputSignal.aggregate_count = signal.aggregate_count;
    if (signal.lucr_stability) safeInputSignal.lucr_stability = signal.lucr_stability;
  }

  if (routingDecision.status === "rejected" && !validation.rejection_reason) {
    validation.rejection_reason = "unsupported_signal_type";
  }
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const opinionEnvelope = {
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
      dao_review_required: false,
      audit_cycle: "quarterly" as const
    }
  };
  const audit = applyAuditHooks(opinionEnvelope, config.auditHooks);
  opinionEnvelope.audit.triggered_hooks = audit.triggeredHooks;
  opinionEnvelope.audit.dao_review_required = audit.daoReviewRequired;
  routingDecision.dao_review_required = audit.daoReviewRequired;

  const layers: RoutingDecision["layer_propagation"] = [];
  if (routingDecision.status === "accepted") {
    layers.push("municipal");
    if (systemOpinion.severity === "warning" || systemOpinion.severity === "critical" || audit.daoReviewRequired) {
      layers.push("county");
    }
    if (audit.triggeredHooks.length > 0) layers.push("state", "federal", "dao");
    routingDecision.layer_propagation = layers;
    routingDecision.escalation_level = layers[layers.length - 1] as RoutingDecision["escalation_level"];
  }

  const ledgerAnchor: RoutingEnvelope["ledger_anchor"] = {
    category: routingDecision.status === "accepted" ? "community_wellbeing" : "rejected_payload",
    governance_document: config.document84Filename,
    audit_cycle: "quarterly",
    flags: {
      privacy_violation: !validation.privacy_compliant,
      consent_missing: !validation.consent_compliant,
      human_origin_missing: !validation.human_origin_verified
    }
  };
  const withoutHashes = { ...opinionEnvelope, ledger_anchor: ledgerAnchor };
  const digest = envelopeHash(withoutHashes);
  const envelope: RoutingEnvelope = {
    ...withoutHashes,
    envelope_id: `sha256:${digest}`,
    deterministic_hash: digest
  };

  const ledger = new ImmutableFileLedger(
    resolve(options.ledgerDir ?? join(configDir, ".beast3-ledger"))
  );
  return ledger.write(envelope);
}
