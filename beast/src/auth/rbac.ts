export type Role = "caseworker" | "admin" | "auditor";
export type Permission = "case:review" | "case:read" | "ledger:read" | "kpi:read" | "config:write";

const GRANTS: Record<Role, readonly Permission[]> = {
  caseworker: ["case:review", "case:read", "kpi:read"],
  admin: ["kpi:read", "config:write"],
  auditor: ["ledger:read", "kpi:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role]?.includes(permission) ?? false;
}

export function authorize(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new Error(`Forbidden: ${role} lacks ${permission}`);
}
