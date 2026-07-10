import {
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export type StagedFeedbackAttachment = {
  storageKey: string;
  extension: "png" | "jpg" | "webp";
  bytes: Buffer;
};

export type StoredFeedbackAttachmentRef = {
  feedbackId: string;
  storageKey: string;
  extension: "png" | "jpg" | "webp";
};

const safeKeyPattern = /^[A-Za-z0-9_-]{1,128}$/;
const allowedExtensions = new Set(["png", "jpg", "webp"]);

export class FeedbackStorage {
  readonly artifactRoot: string;
  readonly feedbackRoot: string;
  readonly stagingRoot: string;

  constructor(artifactRoot = requireArtifactStorageRoot()) {
    this.artifactRoot = path.resolve(artifactRoot);
    this.feedbackRoot = path.join(this.artifactRoot, "feedback");
    this.stagingRoot = path.join(this.feedbackRoot, ".staging");
  }

  async stage(stagingKey: string, attachments: StagedFeedbackAttachment[]) {
    validateKey(stagingKey);
    const root = await this.prepareRoots();
    const directory = containedPath(root.staging, stagingKey);
    await mkdir(directory, { recursive: false });

    try {
      await assertOrdinaryDirectory(directory, root.feedback);
      for (const attachment of attachments) {
        validateKey(attachment.storageKey);
        validateExtension(attachment.extension);
        const filePath = containedPath(directory, `${attachment.storageKey}.${attachment.extension}`);
        await writeFile(filePath, attachment.bytes, { flag: "wx" });
      }
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async commit(stagingKey: string, feedbackId: string) {
    validateKey(stagingKey);
    validateKey(feedbackId);
    const root = await this.prepareRoots();
    const source = containedPath(root.staging, stagingKey);
    const destination = containedPath(root.feedback, feedbackId);
    await assertOrdinaryDirectory(source, root.feedback);

    if (await pathExists(destination)) throw new Error("Feedback destination exists; refusing to overwrite.");
    await rename(source, destination);
    await assertOrdinaryDirectory(destination, root.feedback);
  }

  async read(ref: StoredFeedbackAttachmentRef) {
    validateKey(ref.feedbackId);
    validateKey(ref.storageKey);
    validateExtension(ref.extension);
    const root = await this.prepareRoots();
    const directory = containedPath(root.feedback, ref.feedbackId);
    await assertOrdinaryDirectory(directory, root.feedback);
    const filePath = containedPath(directory, `${ref.storageKey}.${ref.extension}`);
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Attachment is not an ordinary file.");
    const resolved = await realpath(filePath);
    assertContained(root.feedback, resolved);
    return readFile(resolved);
  }

  async hasFinal(feedbackId: string) {
    validateKey(feedbackId);
    const root = await this.prepareRoots();
    return pathExists(containedPath(root.feedback, feedbackId));
  }

  async hasStaging(stagingKey: string) {
    validateKey(stagingKey);
    const root = await this.prepareRoots();
    return pathExists(containedPath(root.staging, stagingKey));
  }

  async removeStaging(stagingKey: string) {
    validateKey(stagingKey);
    const root = await this.prepareRoots();
    await rm(containedPath(root.staging, stagingKey), { recursive: true, force: true });
  }

  async removeFinal(feedbackId: string) {
    validateKey(feedbackId);
    const root = await this.prepareRoots();
    await rm(containedPath(root.feedback, feedbackId), { recursive: true, force: true });
  }

  async listStagingKeys() {
    return (await this.listStagingEntries()).map((entry) => entry.key);
  }

  async listFinalFeedbackIds() {
    return (await this.listFinalEntries()).map((entry) => entry.key);
  }

  async listStagingEntries() {
    const root = await this.prepareRoots();
    return listSafeDirectories(root.staging);
  }

  async listFinalEntries() {
    const root = await this.prepareRoots();
    return listSafeDirectories(root.feedback);
  }

  private async prepareRoots() {
    await mkdir(this.artifactRoot, { recursive: true });
    await assertOrdinaryDirectory(this.artifactRoot, this.artifactRoot);
    const artifact = await realpath(this.artifactRoot);

    await rejectExistingLink(this.feedbackRoot);
    await mkdir(this.feedbackRoot, { recursive: true });
    const feedback = await assertOrdinaryDirectory(this.feedbackRoot, artifact);

    await rejectExistingLink(this.stagingRoot);
    await mkdir(this.stagingRoot, { recursive: true });
    const staging = await assertOrdinaryDirectory(this.stagingRoot, feedback);
    return { artifact, feedback, staging };
  }
}

function requireArtifactStorageRoot() {
  const value = process.env.ARTIFACT_STORAGE_ROOT?.trim();
  if (!value) throw new Error("ARTIFACT_STORAGE_ROOT is required for feedback attachments.");
  return value;
}

function validateKey(value: string) {
  if (!safeKeyPattern.test(value)) throw new Error("Invalid storage key.");
}

function validateExtension(value: string) {
  if (!allowedExtensions.has(value)) throw new Error("Invalid attachment extension.");
}

function containedPath(parent: string, child: string) {
  const candidate = path.resolve(parent, child);
  assertContained(parent, candidate);
  return candidate;
}

function assertContained(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) return;
  throw new Error("Storage path escapes the feedback root.");
}

async function assertOrdinaryDirectory(directory: string, expectedParent: string) {
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Storage directory is a symbolic link or is not a directory.");
  const resolved = await realpath(directory);
  assertContained(expectedParent, resolved);
  return resolved;
}

async function rejectExistingLink(candidate: string) {
  try {
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink()) throw new Error("Storage directory is a symbolic link.");
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}

async function pathExists(candidate: string) {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function listSafeDirectories(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  const safeEntries = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && safeKeyPattern.test(entry.name));
  return Promise.all(safeEntries.map(async (entry) => ({
    key: entry.name,
    modifiedAt: (await lstat(containedPath(directory, entry.name))).mtime,
  })));
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
