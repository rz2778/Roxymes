export type AppRole = "member" | "supervisor" | "admin";

export type Capability =
  | "dashboard:read"
  | "task:self"
  | "task:any"
  | "attachment:self"
  | "order:create"
  | "change:create"
  | "organization:admin";

const ROLE_CAPABILITIES: Record<AppRole, ReadonlySet<Capability>> = {
  member: new Set(["dashboard:read", "task:self", "attachment:self"]),
  supervisor: new Set([
    "dashboard:read",
    "task:self",
    "task:any",
    "attachment:self",
    "order:create",
    "change:create",
  ]),
  admin: new Set([
    "dashboard:read",
    "task:self",
    "task:any",
    "attachment:self",
    "order:create",
    "change:create",
    "organization:admin",
  ]),
};

export function hasCapability(role: AppRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function isSupervisor(role: AppRole): boolean {
  return role === "supervisor" || role === "admin";
}

export function canOperateTask(
  role: AppRole,
  user: { id: number },
  task: { assignee_user_id?: number | null },
): boolean {
  if (hasCapability(role, "task:any")) return true;
  return task.assignee_user_id != null && task.assignee_user_id === user.id;
}
