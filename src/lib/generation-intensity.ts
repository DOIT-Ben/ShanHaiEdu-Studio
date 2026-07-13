import type { GenerationIntensity } from "@/lib/types";

export const generationIntensityOptions: Array<{
  id: GenerationIntensity;
  label: string;
  costLabel: string;
}> = [
  { id: "standard", label: "标准", costLabel: "常规消耗" },
  { id: "enhanced", label: "增强", costLabel: "消耗较高" },
  { id: "deep", label: "深度", costLabel: "消耗高" },
  { id: "extreme", label: "极致", costLabel: "消耗最高" },
];

export function generationIntensityLabel(value: GenerationIntensity | undefined) {
  return generationIntensityOptions.find((option) => option.id === value)?.label ?? "标准";
}
