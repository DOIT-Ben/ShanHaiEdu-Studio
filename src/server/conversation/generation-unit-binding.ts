export type GenerationUnitBinding =
  | { kind: "single"; unitId: string }
  | { kind: "batch" }
  | { kind: "none" }
  | { kind: "invalid" };

export function resolveGenerationUnitBinding(input: {
  authority: string;
  toolName: string;
  request: Record<string, unknown>;
}): GenerationUnitBinding {
  const scalarValues = ["shotId", "unitId", "pageId"]
    .flatMap((key) => text(input.request[key]) ? [text(input.request[key])!] : []);
  if (new Set(scalarValues).size > 1) return { kind: "invalid" };
  const scalar = scalarValues[0] ?? null;

  const shotIds = input.request.shotIds === undefined ? null : textArray(input.request.shotIds);
  if (input.request.shotIds !== undefined && (!shotIds || shotIds.length !== 1)) {
    return { kind: "invalid" };
  }
  const isNativeVideoSegment = input.authority === "main_agent" &&
    (input.toolName === "generate_video_segment" || input.toolName === "generate_video_shot");
  if (isNativeVideoSegment && !shotIds) return { kind: "invalid" };
  if (shotIds) {
    if (scalar && scalar !== shotIds[0]) return { kind: "invalid" };
    return { kind: "single", unitId: shotIds[0] };
  }

  const pageIds = input.request.pageIds === undefined ? null : textArray(input.request.pageIds);
  if (input.request.pageIds !== undefined && !pageIds) return { kind: "invalid" };
  if (pageIds) {
    if (scalar) return { kind: "invalid" };
    return { kind: "batch" };
  }
  return scalar ? { kind: "single", unitId: scalar } : { kind: "none" };
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textArray(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 ||
      !value.every((item) => typeof item === "string" && item.trim())) {
    return null;
  }
  const values = value.map((item) => item.trim());
  return new Set(values).size === values.length ? values : null;
}
