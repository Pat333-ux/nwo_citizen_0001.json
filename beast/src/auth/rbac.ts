export type Role = "caseworker" | "admin" | "auditor";
export type Permission = "case:review" | "case:read" | "ledger:read" | "kpi:read" | "config:write" | "case:create" | "case:decide" | "user:manage" | "ledger:anchor" | "program:read" | "ops:read";

const GRANTS: Record<Role, readonly Permission[]> = {
  caseworker: ["case:review", "case:read", "case:create", "case:decide", "kpi:read", "program:read"],
  admin: ["kpi:read", "config:write", "user:manage", "ledger:anchor", "program:read", "ops:read"],
  auditor: ["ledger:read", "kpi:read", "program:read", "ops:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role]?.includes(permission) ?? false;
}

export function authorize(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new Error(`Forbidden: ${role} lacks ${permission}`);
}
