import fs from "node:fs";
import path from "node:path";
import { require as requireTypeScript } from "tsx/cjs/api";

const root = process.cwd();

function loadTypeScriptModule(relativePath) {
  return requireTypeScript(path.join(root, relativePath), import.meta.url);
}

const requiredRuntimeTasks = [
  "textbook_evidence",
  "lesson_plan",
  "ppt_outline",
  "intro_video_plan",
  "final_delivery_checklist",
];

const requiredAtomicTools = [
  { id: "create_requirement_spec", capabilityId: "requirement_spec", artifactKind: "requirement_spec" },
  { id: "create_lesson_plan", capabilityId: "lesson_plan", artifactKind: "lesson_plan" },
  { id: "create_ppt_outline", capabilityId: "ppt_outline", artifactKind: "ppt_draft" },
  { id: "create_ppt_design_draft", capabilityId: "ppt_design", artifactKind: "ppt_design_draft" },
  { id: "generate_intro_creative_themes", capabilityId: "creative_theme_generate", artifactKind: "creative_theme_generate" },
  { id: "generate_intro_video_script", capabilityId: "video_script_generate", artifactKind: "video_script_generate" },
  { id: "generate_video_storyboard", capabilityId: "storyboard_generate", artifactKind: "storyboard_generate" },
  { id: "create_final_package", capabilityId: "final_package", artifactKind: "final_delivery" },
];

const publishedContractIds = ["requirement_spec", "lesson_plan", "ppt_design", "coze_ppt", "final_package"];

let runtimeLoadError = null;
let taskGuidance = {};
let capabilityDefinitions = [];
let toolDefinitions = [];
let publishedContracts = [];

try {
  ({ taskGuidance } = loadTypeScriptModule("src/server/agent-runtime/task-guidance.ts"));
  const capabilityRegistry = loadTypeScriptModule("src/server/capabilities/capability-registry.ts");
  const toolRegistry = loadTypeScriptModule("src/server/tools/tool-registry.ts");
  capabilityDefinitions = capabilityRegistry.getCapabilityDefinitions();
  toolDefinitions = toolRegistry.listToolDefinitions();
  publishedContracts = publishedContractIds.map((id) =>
    JSON.parse(fs.readFileSync(path.join(root, "config", "node-contracts", `${id}.json`), "utf8")),
  );
} catch (error) {
  runtimeLoadError = error instanceof Error ? error.message : String(error);
}

const capabilitiesById = new Map(capabilityDefinitions.map((definition) => [definition.id, definition]));
const toolsById = new Map(toolDefinitions.map((definition) => [definition.id, definition]));

const checks = [
  {
    id: "runtime-stage3-guidance",
    owner: "Agent Runtime Adapter",
    ok: runtimeLoadError === null && requiredRuntimeTasks.every((task) => Object.hasOwn(taskGuidance, task)),
    required: "Executable runtime guidance must cover every Stage 3 text task.",
    canE2EBypass: false,
  },
  {
    id: "atomic-stage3-tools",
    owner: "Main Agent Tool Registry",
    ok: runtimeLoadError === null && requiredAtomicTools.every((expected) => {
      const tool = toolsById.get(expected.id);
      return tool?.capabilityId === expected.capabilityId &&
        tool.producedArtifactKind === expected.artifactKind &&
        tool.implemented === true &&
        capabilitiesById.has(expected.capabilityId);
    }),
    required: "The executable registry must expose the Stage 3 work as independently callable atomic tools.",
    canE2EBypass: false,
  },
  {
    id: "published-artifact-contracts",
    owner: "Artifact Contract Registry",
    ok: runtimeLoadError === null && publishedContracts.length === publishedContractIds.length &&
      publishedContracts.every((contract, index) =>
        contract.id === publishedContractIds[index] &&
        typeof contract.artifactKind === "string" && contract.artifactKind.length > 0 &&
        Array.isArray(contract.requiredInputs) && contract.requiredInputs.length > 0 &&
        Array.isArray(contract.requiredOutputs) && contract.requiredOutputs.length > 0 &&
        ["internal", "external", "package"].includes(contract.providerPolicy),
      ),
    required: "Published artifact contracts must be valid data contracts independent of any fixed workflow graph.",
    canE2EBypass: false,
  },
];

const blockers = checks.filter((check) => !check.ok);
const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  runtimeLoadError,
  checks,
  blockers,
};

console.log(JSON.stringify(result, null, 2));

if (blockers.length > 0) {
  console.error(`Stage 3 preflight blocked: ${blockers.length} prerequisite(s) missing.`);
  process.exit(1);
}
