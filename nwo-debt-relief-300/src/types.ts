export type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "exists" | "isTrue";

export interface Requirement { field: string; op: Op; value?: unknown }

export interface Program {
  id: string;
  name: string;
  agency: string;
  debtType: string[];
  level: "federal" | "state";
  description: string;
  eligibility: { requirements: string[]; rules?: Requirement[] };
  application: { forms: string[]; instructions: string; autoFill?: Record<string, string> };
  source_urls: string[];
  last_verified: string;
}

export interface Member { id: string; [key: string]: unknown }

export interface Packet {
  programId: string;
  memberId: string;
  forms: string[];
  instructions: string;
  autoFill: Record<string, unknown>;
}

export interface SignedPacket extends Packet { timestamp: string; signature: string }
