import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const providerLedgerDirectory = "API台账系统";
const providerLedgerSegment = providerLedgerDirectory.toLowerCase();
const environmentVariableNamePattern = /^[A-Z][A-Z0-9_]+$/;
const forbiddenLedgerSegments = new Set(["private-local-secrets", "research", "evidence"]);
const forbiddenTopLevelSegments = new Set([
  ".tmp",
  "data",
  "desktop-bundle",
  "dist-desktop",
  "docs",
  "graphify-out",
  "output",
  "playwright-report",
  "test-results",
  "tests",
]);
const forbiddenRootFiles = new Set([
  "electron-builder.config.cjs",
  "next.config.ts",
  "playwright.config.ts",
  "postcss.config.mjs",
  "prisma.config.ts",
  "tsconfig.json",
  "vitest.config.ts",
]);
const allowedRuntimeAssetFiles = new Set([
  "config/development-gates.json",
  "config/orchestration-write-operations.json",
  "fixtures/ppt-sample-manifest.json",
  "src/app/api/admin/feedback/[feedbackid]/attachments/[attachmentid]/route.ts",
  "src/app/api/admin/feedback/[feedbackid]/route.ts",
  "src/app/api/admin/feedback/export/route.ts",
  "src/app/api/admin/feedback/route.ts",
  "src/app/api/feedback/route.ts",
  "src/components/feedback/feedbackdialog.tsx",
  "src/server/feedback/contract.ts",
  "src/server/feedback/export.ts",
  "src/server/feedback/http.ts",
  "src/server/feedback/media.ts",
  "src/server/feedback/repository.ts",
  "src/server/feedback/service-reconciliation.ts",
  "src/server/feedback/service.ts",
  "src/server/feedback/service-shared.ts",
  "src/server/feedback/storage.ts",
  "src/server/health/health-readiness.ts",
  "src/server/health/sqlite-schema-readiness.d.mts",
  "src/server/health/sqlite-schema-readiness.mjs",
  "src/server/provider-ledger/provider-call-trace.ts",
  "src/server/provider-ledger/provider-ledger-adapter.ts",
  "src/server/provider-ledger/provider-ledger-contract.d.mts",
  "src/server/provider-ledger/provider-ledger-contract.mjs",
  "src/server/provider-ledger/v1-9-agent-brain-health-evidence.ts",
  "src/server/skills/business-tool-skill-bindings.ts",
  "src/server/skills/business-tool-skill-output-contract.ts",
  "src/server/skills/business-tool-skill-runtime.ts",
  "src/server/skills/business-tool-skill-result-validator.ts",
  "src/server/skills/business-tool-skill-runtime-execution-helpers.ts",
  "src/server/skills/business-tool-skill-runtime-execution.ts",
  "src/server/skills/skill-contract-schema.ts",
  "src/server/skills/skill-invocation-gateway.ts",
  "src/server/skills/skill-loader.ts",
  "src/server/skills/skill-registry.ts",
  "src/server/skills/skill-resolver.ts",
  "src/server/skills/skill-runtime-event-adapter.ts",
  "src/server/skills/skill-runtime-types.ts",
]);

export function inspectNextBuildOutput({
  cwd = process.cwd(),
  standaloneRoot = path.join(cwd, ".next", "standalone"),
  inspectNft = true,
} = {}) {
  const required = [
    path.join(standaloneRoot, "server.js"),
    path.join(standaloneRoot, providerLedgerDirectory, "manifest.json"),
  ];
  const forbidden = [];
  const standaloneTree = inspectPhysicalTree({ cwd, root: standaloneRoot, location: "standalone" });
  forbidden.push(...standaloneTree.issues);
  const standaloneFileSet = new Set(standaloneTree.files.map((filePath) => path.resolve(filePath)));
  const missing = required
    .filter((filePath) => !standaloneFileSet.has(path.resolve(filePath)))
    .map((filePath) => toPortablePath(path.relative(standaloneRoot, filePath)));

  for (const filePath of standaloneTree.files) {
    const relative = toPortablePath(path.relative(standaloneRoot, filePath));
    if (isForbiddenRuntimePath(relative)) forbidden.push({ location: "standalone", path: relative });
    else if (!isAllowedStandaloneFile(relative)) {
      forbidden.push({ location: "standalone", path: relative, reason: "unexpected_runtime_file" });
    }
  }
  const manifestPath = required[1];
  if (standaloneFileSet.has(path.resolve(manifestPath))) {
    forbidden.push(...inspectPublicProviderManifest(manifestPath));
  }

  let nftFileCount = 0;
  let nftEntryCount = 0;
  if (inspectNft) {
    const nftRoot = path.join(cwd, ".next", "server");
    const nftTree = inspectPhysicalTree({ cwd, root: nftRoot, location: "nft-structure" });
    forbidden.push(...nftTree.issues);
    const nftFiles = nftTree.files.filter((filePath) => filePath.endsWith(".nft.json"));
    const instrumentationTrace = path.join(nftRoot, "instrumentation.js.nft.json");
    if (!nftFiles.some((filePath) => path.resolve(filePath) === path.resolve(instrumentationTrace))) {
      missing.push(".next/server/instrumentation.js.nft.json");
    }
    nftFileCount = nftFiles.length;
    for (const nftPath of nftFiles) {
      const entries = parseNftEntries(nftPath);
      nftEntryCount += entries.length;
      for (const entry of entries) {
        const absolute = path.resolve(path.dirname(nftPath), entry);
        if (!isInside(cwd, absolute)) {
          forbidden.push({
            location: "nft",
            path: toPortablePath(path.relative(cwd, absolute)),
            trace: toPortablePath(path.relative(cwd, nftPath)),
          });
          continue;
        }
        if (existsSync(absolute)) {
          const stat = lstatSync(absolute);
          const canonical = realpathSync.native(absolute);
          if ((stat.isSymbolicLink() && !isAllowedNextDependencyLink(cwd, absolute)) ||
              !isInside(realpathSync.native(cwd), canonical)) {
            forbidden.push({
              location: "nft",
              path: toPortablePath(path.relative(cwd, absolute)),
              trace: toPortablePath(path.relative(cwd, nftPath)),
            });
            continue;
          }
        }
        const projectRelative = path.relative(cwd, absolute);
        if (!isForbiddenRuntimePath(projectRelative)) continue;
        forbidden.push({
          location: "nft",
          path: toPortablePath(projectRelative),
          trace: toPortablePath(path.relative(cwd, nftPath)),
        });
      }
    }
  }

  return {
    ok: missing.length === 0 && forbidden.length === 0,
    standaloneFileCount: standaloneTree.files.length,
    nftFileCount,
    nftEntryCount,
    missing,
    forbidden: uniqueFindings(forbidden),
  };
}

export function isForbiddenRuntimePath(relativePath) {
  const normalized = toPortablePath(relativePath).replace(/^\.\//, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (forbiddenTopLevelSegments.has(lowerSegments[0])) return true;
  if (segments.length === 1 && (forbiddenRootFiles.has(lowerSegments[0]) || lowerSegments[0].endsWith(".md"))) {
    return true;
  }
  if (segments.some((segment) => /^\.env(?:\..*)?$/i.test(segment))) return true;
  if (segments.some((segment) => /\.db(?:$|[-.])/i.test(segment))) return true;
  if (lowerSegments.includes("private-local-secrets")) return true;
  const ledgerIndex = lowerSegments.indexOf(providerLedgerSegment);
  if (ledgerIndex < 0) return false;
  if (lowerSegments.length === ledgerIndex + 1) return false;
  if (forbiddenLedgerSegments.has(lowerSegments[ledgerIndex + 1])) return true;
  return lowerSegments.length !== ledgerIndex + 2 || lowerSegments[ledgerIndex + 1] !== "manifest.json";
}

function isAllowedStandaloneFile(relativePath) {
  const normalized = toPortablePath(relativePath).replace(/^\.\//, "").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  if (["server.js", "package.json", "package-lock.json"].includes(normalized)) return true;
  if ([".next", "node_modules", "public"].includes(segments[0])) return true;
  if (segments[0] === providerLedgerSegment) return normalized === `${providerLedgerSegment}/manifest.json`;
  if (segments[0] === "config" && normalized.startsWith("config/node-contracts/") && normalized.endsWith(".json")) {
    return true;
  }
  return allowedRuntimeAssetFiles.has(normalized);
}

export function sanitizeNextStandalone({
  cwd = process.cwd(),
  standaloneRoot = path.join(cwd, ".next", "standalone"),
} = {}) {
  if (!existsSync(standaloneRoot)) return { removed: 0 };
  const tree = inspectPhysicalTree({ cwd, root: standaloneRoot, location: "standalone" });
  if (tree.issues.length > 0) {
    throw new Error(`Unsafe Next standalone tree: ${tree.issues.map((issue) => issue.path).join(", ")}`);
  }
  let removed = 0;
  const pending = [standaloneRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(standaloneRoot, absolute);
      if (isForbiddenRuntimePath(relative)) {
        assertPhysicalRemovalTarget(standaloneRoot, absolute);
        rmSync(absolute, { recursive: true, force: true });
        removed += 1;
      } else if (entry.isDirectory()) {
        pending.push(absolute);
      }
    }
  }
  return { removed };
}

export function removePhysicalGeneratedDirectory({ cwd = process.cwd(), target }) {
  if (!existsSync(target)) return;
  if (path.resolve(target) === path.resolve(cwd)) throw new Error("Refusing to remove the repository root.");
  const tree = inspectPhysicalTree({ cwd, root: target, location: "generated-output" });
  if (tree.issues.length > 0) {
    throw new Error(`Unsafe generated output tree: ${tree.issues.map((issue) => issue.path).join(", ")}`);
  }
  rmSync(target, { recursive: true, force: true });
}

function parseNftEntries(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`Invalid Next output trace: ${toPortablePath(filePath)}`);
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.files) ||
      !parsed.files.every((entry) => typeof entry === "string")) {
    throw new Error(`Invalid Next output trace contract: ${toPortablePath(filePath)}`);
  }
  return parsed.files;
}

function inspectPhysicalTree({ cwd, root, location }) {
  const files = [];
  const issues = [];
  if (!existsSync(root)) return { files, issues };
  if (!isInside(cwd, root) || pathHasSymbolicLink(cwd, root)) {
    return { files, issues: [{ location, path: toPortablePath(path.relative(cwd, root)), reason: "unsafe_root" }] };
  }
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !isInside(realpathSync.native(cwd), realpathSync.native(root))) {
    return { files, issues: [{ location, path: toPortablePath(path.relative(cwd, root)), reason: "unsafe_root" }] };
  }
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        if (isAllowedNextDependencyLink(cwd, absolute)) files.push(absolute);
        else issues.push({ location, path: toPortablePath(path.relative(root, absolute)), reason: "symbolic_link" });
      } else if (stat.isDirectory()) {
        pending.push(absolute);
      } else if (stat.isFile()) {
        files.push(absolute);
      } else {
        issues.push({ location, path: toPortablePath(path.relative(root, absolute)), reason: "non_regular_file" });
      }
    }
  }
  return { files, issues };
}

function inspectPublicProviderManifest(filePath) {
  try {
    const manifest = JSON.parse(readFileSync(filePath, "utf8"));
    const safe = manifest && typeof manifest === "object" &&
      Number.isInteger(manifest.version) && manifest.version > 0 &&
      manifest.project?.contains_real_secrets === false &&
      manifest.package_modes?.public_zip?.contains_private_env === false &&
      providerCredentialReferencesAreDeclared(manifest.providers) &&
      !manifestContainsSensitiveMaterial(manifest);
    return safe ? [] : [{ location: "standalone", path: `${providerLedgerDirectory}/manifest.json`, reason: "unsafe_manifest" }];
  } catch {
    return [{ location: "standalone", path: `${providerLedgerDirectory}/manifest.json`, reason: "invalid_manifest" }];
  }
}

function providerCredentialReferencesAreDeclared(providers) {
  if (providers === undefined) return true;
  if (!Array.isArray(providers)) return false;
  return providers.every((provider) => {
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) return false;
    if (provider.env_vars !== undefined && (!Array.isArray(provider.env_vars) ||
        !provider.env_vars.every((entry) => typeof entry === "string" && environmentVariableNamePattern.test(entry)))) {
      return false;
    }
    const declared = new Set(provider.env_vars ?? []);
    return credentialEnvironmentReferencesAreDeclared(provider, declared);
  });
}

function credentialEnvironmentReferencesAreDeclared(value, declared) {
  if (Array.isArray(value)) {
    return value.every((entry) => credentialEnvironmentReferencesAreDeclared(entry, declared));
  }
  if (!value || typeof value !== "object") return true;
  return Object.entries(value).every(([key, childValue]) => {
    if (key === "credential_env") {
      return typeof childValue === "string" && environmentVariableNamePattern.test(childValue) &&
        declared.has(childValue);
    }
    return credentialEnvironmentReferencesAreDeclared(childValue, declared);
  });
}

function manifestContainsSensitiveMaterial(value, key = "") {
  if (Array.isArray(value)) return value.some((entry) => manifestContainsSensitiveMaterial(entry, key));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([childKey, childValue]) => {
      const normalizedKey = childKey.toLowerCase();
      const declaration = normalizedKey === "contains_real_secrets" ||
        normalizedKey === "private_mode_contains_real_secrets" ||
        normalizedKey === "contains_private_env";
      if (normalizedKey === "credential_env" &&
          typeof childValue === "string" && environmentVariableNamePattern.test(childValue)) {
        return false;
      }
      if (!declaration && /(^|[_-])(secret|token|password|credential|api[_-]?key|private[_-]?key|access[_-]?key)([_-]|$)/i.test(childKey)) {
        return childValue !== null && childValue !== false && childValue !== "";
      }
      return manifestContainsSensitiveMaterial(childValue, childKey);
    });
  }
  if (typeof value !== "string") return false;
  if (key === "env_vars" && environmentVariableNamePattern.test(value)) return false;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\bsk-[A-Za-z0-9_-]{16,}/i.test(value)) {
    return true;
  }
  if (/^[A-Za-z]:\\Users\\|^\/home\/[^/]+\//i.test(value)) return true;
  try {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:") &&
        (url.username || url.password || [...url.searchParams.keys()].some((name) =>
          /(token|secret|password|key|credential)/i.test(name)))) {
      return true;
    }
  } catch {
    // Most manifest strings are identifiers or relative paths, not URLs.
  }
  return false;
}

function pathHasSymbolicLink(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === "") return lstatSync(root).isSymbolicLink();
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return true;
  let current = path.resolve(root);
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function isAllowedNextDependencyLink(cwd, linkPath) {
  const linkRelative = toPortablePath(path.relative(path.resolve(cwd), path.resolve(linkPath))).toLowerCase();
  if (!linkRelative.startsWith(".next/") || !linkRelative.includes("/node_modules/")) return false;
  const target = realpathSync.native(linkPath);
  return isInside(path.join(realpathSync.native(cwd), "node_modules"), target);
}

function assertPhysicalRemovalTarget(root, candidate) {
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink() || !isInside(realpathSync.native(root), realpathSync.native(candidate))) {
    throw new Error(`Unsafe generated-output removal target: ${toPortablePath(candidate)}`);
  }
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function uniqueFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.location}:${finding.path}:${finding.trace ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toPortablePath(value) {
  return value.replaceAll("\\", "/");
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const sanitization = process.argv.includes("--sanitize") ? sanitizeNextStandalone() : { removed: 0 };
  const result = inspectNextBuildOutput();
  console.log(JSON.stringify({
    ...result,
    sanitizedEntryCount: sanitization.removed,
    forbidden: result.forbidden.slice(0, 50),
  }, null, 2));
  if (!result.ok) process.exit(2);
}
