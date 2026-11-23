export interface DefiExchangeEvent {
  event: "defi.exchange.triggered";
  chainId: number | string;
  txHash: string;
  logIndex: number | string;
  citizen_id: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  finalized: boolean;
  timestamp: string;
}

export interface GateChecks {
  emergencyClear: boolean;
  policyApproved: boolean;
  piiScrubbed: boolean;
  citizenConsentGiven: boolean;
}

export interface CitizenPrototypeConfig {
  citizen_id: string;
  defi_triggers: { enabled: boolean; require_finality: boolean };
  benefits_orchestration: { autoSubmit: boolean; target_domains: string[] };
}

export interface StagedExecutionResult {
  status: "staged" | "blocked" | "duplicate";
  idempotencyKey: string;
  reason?: string;
  autoSubmit: false;
  stagedActions: Array<{
    domain: string;
    action: "evaluate_and_prefill_only";
    requiresManualApproval: true;
  }>;
}

export function buildIdempotencyKey(event: DefiExchangeEvent): string {
  return `${String(event.chainId)}:${event.txHash.trim()}:${String(event.logIndex)}:${event.citizen_id.trim()}`;
}

export function validateEventShape(event: DefiExchangeEvent): string[] {
  const errors: string[] = [];
  if (event.event !== "defi.exchange.triggered") errors.push("Invalid event name");
  if (!event.txHash?.trim()) errors.push("Missing txHash");
  if (event.logIndex === undefined || event.logIndex === null || String(event.logIndex) === "") errors.push("Missing logIndex");
  if (!event.citizen_id?.trim()) errors.push("Missing citizen_id");
  if (!event.tokenIn || !event.tokenOut) errors.push("Missing tokenIn or tokenOut");
  if (!event.amountIn || !event.amountOut) errors.push("Missing amountIn or amountOut");
  if (!event.timestamp) errors.push("Missing timestamp");
  return errors;
}

export function runStagedPrototype(
  config: CitizenPrototypeConfig,
  event: DefiExchangeEvent,
  gates: GateChecks,
  seenKeys: Set<string>
): StagedExecutionResult {
  const idempotencyKey = buildIdempotencyKey(event);

  if (seenKeys.has(idempotencyKey)) {
    return { status: "duplicate", idempotencyKey, reason: "Event already processed for this idempotency key.", autoSubmit: false, stagedActions: [] };
  }

  const shapeErrors = validateEventShape(event);
  if (shapeErrors.length > 0) {
    return { status: "blocked", idempotencyKey, reason: `Invalid event payload: ${shapeErrors.join(", ")}`, autoSubmit: false, stagedActions: [] };
  }
  if (config.citizen_id !== event.citizen_id) {
    return { status: "blocked", idempotencyKey, reason: "Event citizen_id does not match configured citizen.", autoSubmit: false, stagedActions: [] };
  }
  if (!config.defi_triggers.enabled) {
    return { status: "blocked", idempotencyKey, reason: "defi_triggers.enabled is false in prototype config.", autoSubmit: false, stagedActions: [] };
  }
  if (config.defi_triggers.require_finality && !event.finalized) {
    return { status: "blocked", idempotencyKey, reason: "Transaction finality not confirmed.", autoSubmit: false, stagedActions: [] };
  }
  if (!gates.emergencyClear) {
    return { status: "blocked", idempotencyKey, reason: "Blocked by emergency circuit breaker (div-19-emergency-response).", autoSubmit: false, stagedActions: [] };
  }
  if (!gates.policyApproved) {
    return { status: "blocked", idempotencyKey, reason: "Blocked by policy guard (beast3-constitutional-policy-guard).", autoSubmit: false, stagedActions: [] };
  }
  if (!gates.piiScrubbed) {
    return { status: "blocked", idempotencyKey, reason: "Blocked: PII scrubber has not verified payload.", autoSubmit: false, stagedActions: [] };
  }
  if (!gates.citizenConsentGiven) {
    return { status: "blocked", idempotencyKey, reason: "Blocked: citizen consent is not verified.", autoSubmit: false, stagedActions: [] };
  }

  seenKeys.add(idempotencyKey);
  const stagedActions = config.benefits_orchestration.target_domains.map((domain) => ({
    domain,
    action: "evaluate_and_prefill_only" as const,
    requiresManualApproval: true as const
  }));

  return { status: "staged", idempotencyKey, autoSubmit: false, stagedActions };
}
