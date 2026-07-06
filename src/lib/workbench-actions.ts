import type { ArtifactItem } from "@/lib/types";

type ArtifactActionKind = "confirm" | "regenerate";

export function resolveArtifactActionKey(item: ArtifactItem, action: ArtifactActionKind): string | null {
  const allowed = action === "confirm" ? item.actions.canConfirm : item.actions.canRegenerate;
  if (!allowed) return null;
  return item.artifactId ?? item.key;
}
