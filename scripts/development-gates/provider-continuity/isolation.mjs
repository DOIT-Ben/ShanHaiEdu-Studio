import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

export function createCampaignWorkspace({ root = process.cwd(), campaignId } = {}) {
  const repositoryRoot = realpathSync(path.resolve(root));
  const safeCampaignId = requireIdentifier(campaignId);
  const campaignsRoot = path.join(repositoryRoot, ".tmp", "provider-continuity", "campaigns");
  assertOrdinaryAncestors(repositoryRoot, campaignsRoot);
  mkdirSync(campaignsRoot, { recursive: true });
  assertPhysicalDescendant(repositoryRoot, campaignsRoot, "campaigns root");

  const campaignRoot = path.join(campaignsRoot, safeCampaignId);
  if (existsSync(campaignRoot)) throw new Error(`Campaign workspace already exists: ${safeCampaignId}.`);
  mkdirSync(campaignRoot);
  const result = { root: campaignRoot };
  for (const name of ["database", "artifacts", "capture", "evidence", "logs"]) {
    const directory = path.join(campaignRoot, name);
    mkdirSync(directory);
    assertPhysicalDescendant(campaignRoot, directory, `${name} directory`);
    result[name] = directory;
  }
  return Object.freeze(result);
}

function assertOrdinaryAncestors(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Campaign root escapes the repository.");
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && current !== target)) {
      throw new Error("Campaign workspace must not traverse a link or non-directory path.");
    }
  }
}

function assertPhysicalDescendant(root, target, label) {
  const physicalRoot = realpathSync(root);
  const physicalTarget = realpathSync(target);
  const relative = path.relative(physicalRoot, physicalTarget);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a physical child directory.`);
  }
}

function requireIdentifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value)) {
    throw new Error("campaignId is invalid.");
  }
  return value;
}
