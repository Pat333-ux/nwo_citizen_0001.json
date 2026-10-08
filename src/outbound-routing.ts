import type { RoutingEnvelope } from "./wellbeing-pipeline.ts";

export interface OutboundDelivery {
  service_path: string;
  status: "delivered" | "failed";
  error_code?: "network_error" | "http_error";
}

export type OutboundTargets = Record<string, string>;

export function validateOutboundTargets(targets: OutboundTargets): void {
  for (const target of Object.values(targets)) {
    const url = new URL(target);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new TypeError("Outbound targets must be credential-free HTTPS URLs without query or fragment");
    }
  }
}

export async function dispatchAggregateEnvelope(
  envelope: RoutingEnvelope,
  targets: OutboundTargets,
  timeoutMs = 5_000,
  sender: typeof fetch = fetch,
  idempotencyKey?: string
): Promise<OutboundDelivery[]> {
  if (envelope.routing_decision.status !== "accepted") return [];
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("Outbound timeout must be a positive safe integer");
  }
  validateOutboundTargets(targets);
  const paths = [...new Set([
    envelope.routing_decision.primary_service_path,
    ...envelope.routing_decision.secondary_paths
  ].filter((path): path is string => path !== null))];
  const deliveries: OutboundDelivery[] = [];
  for (const servicePath of paths) {
    const endpoint = targets[servicePath];
    if (!endpoint) continue;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const request = {
        signal_type: envelope.input_signal.signal_type,
        aggregate_count: envelope.input_signal.aggregate_count,
        service_path: servicePath,
        escalation_level: envelope.routing_decision.escalation_level
      };
      const response = await sender(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });
      deliveries.push({
        service_path: servicePath,
        status: response.ok ? "delivered" : "failed",
        ...response.ok ? {} : { error_code: "http_error" as const }
      });
    } catch {
      deliveries.push({
        service_path: servicePath,
        status: "failed",
        error_code: "network_error"
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  return deliveries;
}

export function targetsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): OutboundTargets {
  const names: Record<string, string> = {
    food: "BEAST3_TARGET_FOOD",
    shelter: "BEAST3_TARGET_SHELTER",
    medical: "BEAST3_TARGET_MEDICAL",
    social_services: "BEAST3_TARGET_SOCIAL_SERVICES",
    community_orgs: "BEAST3_TARGET_COMMUNITY_ORGS"
  };
  const targets: OutboundTargets = {};
  for (const [path, variable] of Object.entries(names)) {
    const target = environment[variable];
    if (target) targets[path] = target;
  }
  validateOutboundTargets(targets);
  return targets;
}
