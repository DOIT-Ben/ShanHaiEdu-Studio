import type { AgentRuntimeTask } from "./types";

const runtimeOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assistantMessage", "artifactDraft", "nextSuggestedAction"],
  properties: {
    assistantMessage: {
      type: "object",
      additionalProperties: false,
      required: ["title", "body"],
      properties: {
        title: { type: "string" },
        body: { type: "string" },
      },
    },
    artifactDraft: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "markdown", "structuredContentJson"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        markdown: { type: "string" },
        structuredContentJson: {
          anyOf: [
            { type: "string" },
            { type: "null" },
          ],
        },
      },
    },
    nextSuggestedAction: {
      type: "object",
      additionalProperties: false,
      required: ["label"],
      properties: {
        label: { type: "string" },
      },
    },
  },
};

const durationRangeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["minSeconds", "maxSeconds"],
  properties: {
    minSeconds: { type: "integer" },
    maxSeconds: { type: "integer" },
  },
} as const;

const storyboardRuntimeOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assistantMessage", "artifactDraft", "nextSuggestedAction"],
  properties: {
    assistantMessage: runtimeOutputJsonSchema.properties.assistantMessage,
    artifactDraft: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "videoStoryboardManifest"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        videoStoryboardManifest: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "intent", "shots", "references"],
          properties: {
            schemaVersion: { type: "string", const: "video-storyboard.v1" },
            intent: {
              type: "object",
              additionalProperties: false,
              required: ["schemaVersion", "productionPath", "videoMode", "targetDurationRange", "courseAnchor", "classroomReturnQuestion", "answerDisclosureBoundary"],
              properties: {
                schemaVersion: { type: "string", const: "video-intent.v1" },
                productionPath: { type: "string", enum: ["video_short_preview", "video_full_intro"] },
                videoMode: { type: "string", enum: ["short_preview", "full_intro"] },
                targetDurationRange: durationRangeSchema,
                courseAnchor: { type: "string" },
                classroomReturnQuestion: { type: "string" },
                answerDisclosureBoundary: { type: "string" },
              },
            },
            shots: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["shotId", "ordinal", "durationTargetRange", "sceneFunction", "mainSubject", "subjectAction", "cameraMotion", "continuityKeys", "startFrameIntent", "endFrameIntent", "referencePolicy", "textPolicy", "modelPrompt", "negativePrompt", "retakeVariables"],
                properties: {
                  shotId: { type: "string" },
                  ordinal: { type: "integer" },
                  durationTargetRange: durationRangeSchema,
                  sceneFunction: { type: "string" },
                  mainSubject: { type: "string" },
                  subjectAction: { type: "string" },
                  cameraMotion: { type: "string" },
                  continuityKeys: { type: "array", items: { type: "string" } },
                  startFrameIntent: { type: "string" },
                  endFrameIntent: { type: "string" },
                  referencePolicy: { type: "string", enum: ["required", "recommended", "none"] },
                  textPolicy: { type: "string", enum: ["no_generated_text", "post_production_only"] },
                  modelPrompt: { type: "string" },
                  negativePrompt: { type: "string" },
                  retakeVariables: { type: "array", items: { type: "string" } },
                },
              },
            },
            references: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["assetId", "assetDomain", "sha256", "applicableShotIds", "purpose"],
                properties: {
                  assetId: { type: "string" },
                  assetDomain: { type: "string", const: "video" },
                  sha256: { type: ["string", "null"] },
                  applicableShotIds: { type: "array", items: { type: "string" } },
                  purpose: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    nextSuggestedAction: runtimeOutputJsonSchema.properties.nextSuggestedAction,
  },
} as const;

export function runtimeOutputJsonSchemaFor(task: AgentRuntimeTask) {
  return task === "storyboard_generate" ? storyboardRuntimeOutputJsonSchema : runtimeOutputJsonSchema;
}
