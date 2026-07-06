import type { ArtifactStatus } from "@/lib/types";

export const artifactStatusMeta: Record<
  ArtifactStatus,
  { label: string; tone: "neutral" | "success" | "warning" | "info" | "danger" | "bronze"; dot: string }
> = {
  approved: { label: "已确认", tone: "success", dot: "bg-[#9aa2ad]" },
  needs_review: { label: "待确认", tone: "bronze", dot: "bg-[#8f949c]" },
  in_progress: { label: "生成中", tone: "info", dot: "bg-[#9aa2ad]" },
  blocked: { label: "需处理", tone: "danger", dot: "bg-[#9b4a4a]" },
  stale: { label: "需重审", tone: "bronze", dot: "bg-[#8f949c]" },
  not_started: { label: "未开始", tone: "neutral", dot: "bg-[#c9ced6]" },
};

export function getArtifactStatusMeta(status: ArtifactStatus) {
  return artifactStatusMeta[status];
}
