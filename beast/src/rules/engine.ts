import type { FamilyProfile } from "../types/FamilyProfile.ts";

export interface Rule {
  ruleId: string;
  field: string;
  operator: "<" | "<=" | ">" | ">=" | "==";
  valueSource: string;
  service: string;
  reason: string;
}

export interface Decision {
  program: string;
  reason: string;
}

export type RuleContext = Record<string, number | boolean | string>;

export function buildContext(p: FamilyProfile, reference: Record<string, number>): RuleContext {
  return {
    householdIncome: p.monthlyIncome,
    adults: p.adults,
    children: p.children,
    veteranStatus: p.veteranStatus,
    disabilityStatus: p.disabilityStatus,
    housingStatus: p.housingStatus,
    ...reference,
  };
}

function compare(op: Rule["operator"], a: unknown, b: unknown): boolean {
  switch (op) {
    case "<": return (a as number) < (b as number);
    case "<=": return (a as number) <= (b as number);
    case ">": return (a as number) > (b as number);
    case ">=": return (a as number) >= (b as number);
    case "==": return a === b;
  }
}

/**
 * Data-driven, deterministic. Returns recommendations only: it never
 * approves anything. A caseworker must make the final decision.
 */
export function runRules(rules: Rule[], ctx: RuleContext): Decision[] {
  const out: Decision[] = [];
  for (const r of rules) {
    if (!(r.field in ctx) || !(r.valueSource in ctx)) continue;
    if (compare(r.operator, ctx[r.field], ctx[r.valueSource])) {
      out.push({ program: r.service, reason: r.reason });
    }
  }
  return out;
}
