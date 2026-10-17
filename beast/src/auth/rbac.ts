export type Role = "caseworker" | "admin" | "auditor" | "member";
export type Permission = "case:review" | "case:read" | "ledger:read" | "kpi:read" | "config:write" | "case:create" | "case:decide" | "user:manage" | "assistant:use" | "resources:read" | "member:manage" | "me:read" | "me:act";

const GRANTS: Record<Role, readonly Permission[]> = {
  caseworker: ["case:review", "case:read", "case:create", "case:decide", "kpi:read", "assistant:use", "resources:read", "member:manage"],
  admin: ["kpi:read", "config:write", "user:manage", "assistant:use", "resources:read", "member:manage"],
  member: ["me:read", "me:act", "assistant:use", "resources:read"],
  auditor: ["ledger:read", "kpi:read", "resources:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role]?.includes(permission) ?? false;
}

export function authorize(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new Error(`Forbidden: ${role} lacks ${permission}`);
}
