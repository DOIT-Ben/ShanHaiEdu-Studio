import type { WorkbenchActor } from "@/server/auth/actor";
import { getProjectMembershipRole } from "@/server/auth/actor";

type ProjectLike = {
  id: string;
  ownerUserId?: string | null;
};

export function canReadProject(project: ProjectLike, actor?: WorkbenchActor) {
  if (!actor) return true;
  if (actor.isAdmin) return true;
  if (project.ownerUserId === actor.userId) return true;
  if (!project.ownerUserId && resolveActorAuthMode(actor) === "local") return true;
  return getProjectMembershipRole(actor, project.id) !== null;
}

export function canWriteProjectContent(project: ProjectLike, actor?: WorkbenchActor) {
  if (!actor) return true;
  if (project.ownerUserId === actor.userId) return true;
  if (!project.ownerUserId && resolveActorAuthMode(actor) === "local") return true;
  const membershipRole = getProjectMembershipRole(actor, project.id);
  return membershipRole === "owner" || membershipRole === "editor";
}

export function canTriggerGeneration(project: ProjectLike, actor?: WorkbenchActor) {
  return canWriteProjectContent(project, actor);
}

export function canManageProjectMembers(project: ProjectLike, actor?: WorkbenchActor) {
  if (!actor) return true;
  if (actor.isAdmin) return true;
  if (project.ownerUserId === actor.userId) return true;
  return getProjectMembershipRole(actor, project.id) === "owner";
}

export function canManageFeedback(actor?: WorkbenchActor | null) {
  return Boolean(actor?.userId?.trim() && actor.authMode === "password" && actor.isAdmin === true);
}

export function canManageUsers(actor?: WorkbenchActor | null) {
  return Boolean(actor?.userId?.trim() && actor.authMode === "password" && actor.isAdmin === true);
}

function resolveActorAuthMode(actor: WorkbenchActor) {
  return actor.authMode ?? "local";
}
