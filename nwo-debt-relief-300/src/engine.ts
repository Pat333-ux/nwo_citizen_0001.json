import { loadPrograms } from "./loaders/programs.ts";
import type { Member, Packet, Program, Requirement } from "./types.ts";

export const programs: Program[] = loadPrograms();

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

export function checkRequirement(req: Requirement, member: Member): boolean {
  const v: any = getPath(member, req.field);
  switch (req.op) {
    case "eq": return v === req.value;
    case "neq": return v !== req.value;
    case "gt": return typeof v === "number" && v > (req.value as number);
    case "gte": return typeof v === "number" && v >= (req.value as number);
    case "lt": return typeof v === "number" && v < (req.value as number);
    case "lte": return typeof v === "number" && v <= (req.value as number);
    case "in": return Array.isArray(req.value) && req.value.includes(v);
    case "exists": return v !== undefined && v !== null;
    case "isTrue": return v === true;
    default: return false;
  }
}

export function evaluateEligibility(member: Member): Program[] {
  return programs.filter(p => p.eligibility.requirements.every(r => checkRequirement(r, member)));
}

export function autoFill(program: Program, member: Member): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(program.application.autoFill)) {
    out[field] = getPath(member, path) ?? null;
  }
  return out;
}

export function generateApplicationPacket(program: Program, member: Member): Packet {
  return {
    programId: program.id,
    memberId: member.id,
    forms: program.application.forms,
    instructions: program.application.instructions,
    autoFill: autoFill(program, member)
  };
}

export function runPipeline(member: Member): Packet[] {
  return evaluateEligibility(member).map(p => generateApplicationPacket(p, member));
}
