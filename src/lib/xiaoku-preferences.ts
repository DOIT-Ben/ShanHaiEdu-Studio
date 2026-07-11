export type XiaoKuResponseStyle = "concise" | "pragmatic";

export const xiaokuResponseStyleOptions = [
  { id: "concise", label: "简洁直接", description: "先给结论，只保留必要说明。" },
  { id: "pragmatic", label: "务实展开", description: "给出可执行建议，并说明关键取舍。" },
] as const satisfies ReadonlyArray<{ id: XiaoKuResponseStyle; label: string; description: string }>;

export function normalizeXiaoKuResponseStyle(value: unknown): XiaoKuResponseStyle {
  return value === "concise" ? "concise" : "pragmatic";
}

export function xiaokuResponseStyleLabel(value: XiaoKuResponseStyle) {
  return xiaokuResponseStyleOptions.find((option) => option.id === value)?.label ?? "务实展开";
}
