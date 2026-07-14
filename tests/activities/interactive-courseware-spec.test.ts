import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import {
  validateInteractiveCoursewareSpec,
  type InteractiveCoursewareSpec,
} from "@/server/activities/interactive-courseware-spec";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "interactive-courseware-tests");
const databasePath = path.join(stageRoot, `courseware-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;

let client: PrismaClient;

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) {
    throw new Error(initialized.stderr || initialized.stdout || "Interactive courseware test database initialization failed.");
  }
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await client?.$disconnect();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

function createValidSpec(): InteractiveCoursewareSpec {
  return {
    schemaVersion: "interactive-courseware.v1",
    title: "Fractions introduction",
    learningObjectives: [{ id: "objective-1", text: "Identify one half" }],
    pages: [
      {
        id: "page-1",
        title: "Warm up",
        activities: [
          {
            id: "single-1",
            type: "single_choice",
            learningObjectiveIds: ["objective-1"],
            timeLimitSeconds: 30,
            endCondition: "answer_submitted",
            stem: "Which image shows one half?",
            options: [
              { id: "option-a", text: "One of two equal parts" },
              { id: "option-b", text: "One of three equal parts" },
            ],
            correctOptionIds: ["option-a"],
          },
        ],
      },
    ],
  };
}

describe("interactive courseware spec", () => {
  it("accepts a valid single-choice activity", () => {
    const result = validateInteractiveCoursewareSpec(createValidSpec());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("supports every first-release activity type", () => {
    const spec = createValidSpec();
    spec.pages[0].activities = [
      {
        id: "single-1",
        type: "single_choice",
        learningObjectiveIds: ["objective-1"],
        timeLimitSeconds: 30,
        endCondition: "answer_submitted",
        stem: "Single choice",
        options: [{ id: "option-a", text: "A" }],
        correctOptionIds: ["option-a"],
      },
      {
        id: "multiple-1",
        type: "multiple_choice",
        learningObjectiveIds: ["objective-1"],
        timeLimitSeconds: 30,
        endCondition: "answer_submitted",
        stem: "Multiple choice",
        options: [{ id: "option-b", text: "B" }, { id: "option-c", text: "C" }],
        correctOptionIds: ["option-b", "option-c"],
      },
      {
        id: "true-false-1",
        type: "true_false",
        learningObjectiveIds: ["objective-1"],
        timeLimitSeconds: 20,
        endCondition: "answer_submitted",
        stem: "True or false",
        correctValue: true,
      },
      {
        id: "fill-blank-1",
        type: "fill_blank",
        learningObjectiveIds: ["objective-1"],
        timeLimitSeconds: 30,
        endCondition: "answer_submitted",
        stem: "Fill the blank",
        acceptedAnswers: ["one half", "1/2"],
      },
      {
        id: "drag-match-1",
        type: "drag_match",
        learningObjectiveIds: ["objective-1"],
        timeLimitSeconds: 45,
        endCondition: "all_pairs_matched",
        pairs: [{ leftId: "left-1", rightId: "right-1" }],
      },
    ];

    expect(validateInteractiveCoursewareSpec(spec).ok).toBe(true);
  });

  it("rejects duplicate activity ids with a precise locator", () => {
    const spec = createValidSpec();
    spec.pages.push({ ...spec.pages[0], id: "page-2" });

    const result = validateInteractiveCoursewareSpec(spec);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "DUPLICATE_ACTIVITY_ID", path: "pages[1].activities[0].id" }));
  });

  it("rejects answers that do not refer to an option", () => {
    const spec = createValidSpec();
    const activity = spec.pages[0].activities[0];
    if (activity.type !== "single_choice") throw new Error("Test fixture is invalid.");
    activity.correctOptionIds = ["missing-option"];

    const result = validateInteractiveCoursewareSpec(spec);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "INVALID_CORRECT_OPTION", path: "pages[0].activities[0].correctOptionIds[0]" }));
  });

  it("requires objective mapping, a time limit, and an end condition", () => {
    const spec = createValidSpec();
    const activity = spec.pages[0].activities[0];
    activity.learningObjectiveIds = [];
    activity.timeLimitSeconds = 0;
    activity.endCondition = "";

    const result = validateInteractiveCoursewareSpec(spec);

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "MISSING_OBJECTIVE_MAPPING",
      "INVALID_TIME_LIMIT",
      "MISSING_END_CONDITION",
    ]));
  });

  it("persists only a validated spec as a versioned project artifact", async () => {
    const service = createWorkbenchService(createPrismaWorkbenchRepository(client));
    const project = await service.createProject({ title: "Interactive courseware persistence" });
    const artifact = await service.saveInteractiveCoursewareSpec(project.id, { spec: createValidSpec() });
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(artifact.kind).toBe("interactive_courseware_spec");
    expect(artifact.nodeKey).toBe("interactive_courseware_spec");
    expect(artifact.structuredContent.interactiveCoursewareSpec).toMatchObject({ schemaVersion: "interactive-courseware.v1" });
    expect(snapshot.nodes.find((node) => node.key === "interactive_courseware_spec")?.status).toBe("needs_review");
  });
});
