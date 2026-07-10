import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FeedbackStorage } from "@/server/feedback/storage";
import { createFeedbackImage } from "./support/feedback-fixtures";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FeedbackStorage", () => {
  it("stages attachments and atomically renames the directory on commit", async () => {
    const root = createRoot();
    const storage = new FeedbackStorage(root);
    const bytes = await createFeedbackImage("png");

    await storage.stage("stage-1", [{ storageKey: "asset-1", extension: "png", bytes }]);
    await storage.commit("stage-1", "feedback-1");

    await expect(readFile(path.join(root, "feedback", "feedback-1", "asset-1.png"))).resolves.toEqual(bytes);
    await expect(access(path.join(root, "feedback", ".staging", "stage-1"))).rejects.toThrow();
  });

  it("does not overwrite an existing final feedback directory", async () => {
    const root = createRoot();
    const storage = new FeedbackStorage(root);
    const bytes = await createFeedbackImage("png");

    await storage.stage("stage-1", [{ storageKey: "asset-1", extension: "png", bytes }]);
    await storage.commit("stage-1", "feedback-1");
    await storage.stage("stage-2", [{ storageKey: "asset-2", extension: "png", bytes }]);

    await expect(storage.commit("stage-2", "feedback-1")).rejects.toThrow(/exists|overwrite/i);
  });

  it("rejects path traversal and a symlinked feedback root", async () => {
    const root = createRoot();
    const storage = new FeedbackStorage(root);
    const bytes = await createFeedbackImage("png");
    await expect(storage.stage("../escape", [{ storageKey: "asset-1", extension: "png", bytes }])).rejects.toThrow(/key/i);

    const target = path.join(root, "target");
    await mkdir(target, { recursive: true });
    await mkdir(root, { recursive: true });
    await symlink(target, path.join(root, "feedback"), "junction");
    await expect(new FeedbackStorage(root).stage("stage-1", [{ storageKey: "asset-1", extension: "png", bytes }])).rejects.toThrow(/symbolic|link/i);
  });

  it("cleans the complete staging directory after a partial write failure", async () => {
    const root = createRoot();
    const storage = new FeedbackStorage(root);
    const bytes = await createFeedbackImage("png");

    await expect(storage.stage("stage-1", [
      { storageKey: "same-key", extension: "png", bytes },
      { storageKey: "same-key", extension: "png", bytes },
    ])).rejects.toThrow();
    await expect(access(path.join(root, "feedback", ".staging", "stage-1"))).rejects.toThrow();
  });

  it("reads only a trusted database attachment reference", async () => {
    const root = createRoot();
    const storage = new FeedbackStorage(root);
    const bytes = await createFeedbackImage("webp");
    await storage.stage("stage-1", [{ storageKey: "asset-1", extension: "webp", bytes }]);
    await storage.commit("stage-1", "feedback-1");

    await expect(storage.read({ feedbackId: "feedback-1", storageKey: "asset-1", extension: "webp" })).resolves.toEqual(bytes);
    await expect(storage.read({ feedbackId: "../escape", storageKey: "asset-1", extension: "webp" })).rejects.toThrow(/key/i);
  });
});

function createRoot() {
  const root = path.join(process.cwd(), ".tmp", `feedback-storage-${randomUUID()}`);
  roots.push(root);
  return root;
}
