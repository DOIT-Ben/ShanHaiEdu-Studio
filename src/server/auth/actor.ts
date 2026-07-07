export type AuthMode = "local" | "password" | "oauth" | "sso";

export type WorkbenchSystemRole = "teacher" | "admin";

export type ProjectMembershipRole = "owner" | "editor" | "viewer";

export type WorkbenchActor = {
  userId: string;
  role: WorkbenchSystemRole;
  displayName: string;
  authMode: AuthMode;
  isAdmin: boolean;
  projectRoles: Record<string, ProjectMembershipRole>;
};

export type CreateWorkbenchActorInput = {
  userId: string;
  displayName: string;
  authMode: AuthMode;
  role?: WorkbenchSystemRole;
  projectRoles?: Record<string, ProjectMembershipRole>;
};

export function createWorkbenchActor(input: CreateWorkbenchActorInput): WorkbenchActor {
  const role = input.role ?? "teacher";
  return {
    userId: input.userId,
    role,
    displayName: input.displayName,
    authMode: input.authMode,
    isAdmin: role === "admin",
    projectRoles: input.projectRoles ?? {},
  };
}

export function getProjectMembershipRole(actor: WorkbenchActor, projectId: string) {
  return actor.projectRoles?.[projectId] ?? null;
}

export function isPublicAuthMode(authMode: AuthMode) {
  return (authMode ?? "local") !== "local";
}
