import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const BASELINE_FIELDS = ["lines", "violatingFunctions", "maxFunctionLines", "totalFunctionLines"];

function normalizeRepoPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function globToRegExp(pattern) {
  const normalized = normalizeRepoPath(pattern);
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          expression += "(?:.*/)?";
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

function matchesAnyGlob(filePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(filePath));
}

function isWithinRoot(filePath, root) {
  const normalizedRoot = normalizeRepoPath(root).replace(/\/$/, "");
  return filePath === normalizedRoot || filePath.startsWith(`${normalizedRoot}/`);
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

function validateRepoRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const normalized = normalizeRepoPath(value);
  if (path.isAbsolute(value) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} must stay inside the repository: ${value}`);
  }
  return normalized;
}

function validatePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("complexity policy must be an object");
  }
  if (!isNonEmptyStringArray(policy.roots)) {
    throw new Error("complexity policy.roots must be a non-empty string array");
  }
  if (!Array.isArray(policy.excludedPaths) || !policy.excludedPaths.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error("complexity policy.excludedPaths must be a string array");
  }
  if (!Number.isInteger(policy.maxFileLines) || policy.maxFileLines <= 0) {
    throw new Error("complexity policy.maxFileLines must be a positive integer");
  }
  if (!Number.isInteger(policy.maxFunctionLines) || policy.maxFunctionLines <= 0) {
    throw new Error("complexity policy.maxFunctionLines must be a positive integer");
  }
  if (!Array.isArray(policy.baseline)) {
    throw new Error("complexity policy.baseline must be an array");
  }

  const seen = new Set();
  const baseline = policy.baseline.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`complexity baseline[${index}] must be an object`);
    }
    const entryPath = validateRepoRelativePath(entry.path, `complexity baseline[${index}].path`);
    if (seen.has(entryPath)) throw new Error(`complexity baseline contains duplicate path: ${entryPath}`);
    seen.add(entryPath);
    for (const field of BASELINE_FIELDS) {
      if (!Number.isInteger(entry[field]) || entry[field] < 0) {
        throw new Error(`complexity baseline[${index}].${field} must be a non-negative integer`);
      }
    }
    if (entry.lines <= 0) throw new Error(`complexity baseline[${index}].lines must be positive`);
    if (
      (entry.violatingFunctions === 0 && (entry.maxFunctionLines !== 0 || entry.totalFunctionLines !== 0))
      || (entry.violatingFunctions > 0 && (
        entry.maxFunctionLines <= policy.maxFunctionLines
        || entry.totalFunctionLines < entry.maxFunctionLines
      ))
    ) {
      throw new Error(`complexity baseline[${index}] has inconsistent function statistics`);
    }
    if (entry.lines <= policy.maxFileLines && entry.violatingFunctions === 0) {
      throw new Error(`complexity baseline[${index}] does not describe threshold debt`);
    }
    return {
      path: entryPath,
      lines: entry.lines,
      violatingFunctions: entry.violatingFunctions,
      maxFunctionLines: entry.maxFunctionLines,
      totalFunctionLines: entry.totalFunctionLines,
    };
  });

  return {
    roots: policy.roots.map((root, index) => validateRepoRelativePath(root, `complexity roots[${index}]`)),
    excludedPaths: policy.excludedPaths.map(normalizeRepoPath),
    maxFileLines: policy.maxFileLines,
    maxFunctionLines: policy.maxFunctionLines,
    baseline: baseline.sort((left, right) => comparePaths(left.path, right.path)),
  };
}

function scriptKindForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".js", ".mjs", ".cjs"].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function physicalLineCount(content) {
  if (content.length === 0) return 0;
  const normalized = content.replace(/\r\n?/g, "\n");
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n").length
    : normalized.split("\n").length;
}

function isFunctionLike(node) {
  return ts.isArrowFunction(node)
    || ts.isConstructorDeclaration(node)
    || ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isSetAccessorDeclaration(node);
}

function functionLineCount(node, sourceFile) {
  const start = node.getStart(sourceFile, false);
  const end = Math.max(start, node.end - 1);
  const startLine = sourceFile.getLineAndCharacterOfPosition(start).line;
  const endLine = sourceFile.getLineAndCharacterOfPosition(end).line;
  return endLine - startLine + 1;
}

function analyzeFile(file, policy) {
  const sourceFile = ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(file.path),
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    throw new Error(`Cannot parse ${file.path}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }

  const violatingFunctionLines = [];
  const visit = (node) => {
    if (isFunctionLike(node)) {
      const lines = functionLineCount(node, sourceFile);
      if (lines > policy.maxFunctionLines) violatingFunctionLines.push(lines);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const lines = physicalLineCount(file.content);
  if (lines <= policy.maxFileLines && violatingFunctionLines.length === 0) return undefined;
  return {
    path: file.path,
    lines,
    violatingFunctions: violatingFunctionLines.length,
    maxFunctionLines: violatingFunctionLines.length === 0 ? 0 : Math.max(...violatingFunctionLines),
    totalFunctionLines: violatingFunctionLines.reduce((total, value) => total + value, 0),
  };
}

export function analyzeComplexityDebt(files, unvalidatedPolicy) {
  const policy = validatePolicy(unvalidatedPolicy);
  const actual = [];
  for (const file of files) {
    const filePath = validateRepoRelativePath(file.path, "source file path");
    if (!policy.roots.some((root) => isWithinRoot(filePath, root))) continue;
    if (matchesAnyGlob(filePath, policy.excludedPaths)) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;
    if (typeof file.content !== "string") throw new Error(`source file content must be a string: ${filePath}`);
    const entry = analyzeFile({ path: filePath, content: file.content }, policy);
    if (entry) actual.push(entry);
  }
  return actual.sort((left, right) => comparePaths(left.path, right.path));
}

function compareBaseline(actual, baseline) {
  const errors = [];
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
  const baselineByPath = new Map(baseline.map((entry) => [entry.path, entry]));

  for (const entry of actual) {
    const expected = baselineByPath.get(entry.path);
    if (!expected) {
      errors.push(`New complexity debt: ${entry.path}`);
      continue;
    }
    for (const field of BASELINE_FIELDS) {
      if (entry[field] !== expected[field]) {
        errors.push(`${entry.path} ${field} changed from ${expected[field]} to ${entry[field]}; update the code and ratchet policy explicitly`);
      }
    }
  }
  for (const entry of baseline) {
    if (!actualByPath.has(entry.path)) {
      errors.push(`${entry.path} no longer exists in actual debt; remove the stale baseline entry explicitly`);
    }
  }
  return errors;
}

export function evaluateComplexityDebt(files, unvalidatedPolicy) {
  const policy = validatePolicy(unvalidatedPolicy);
  const actual = analyzeComplexityDebt(files, policy);
  const errors = compareBaseline(actual, policy.baseline);
  return { ok: errors.length === 0, actual, errors };
}

function collectFiles(repoRoot, roots) {
  const files = [];
  const resolvedRoot = path.resolve(repoRoot);
  const visit = (absolutePath) => {
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true })
      .sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      const child = path.join(absolutePath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push({
          path: normalizeRepoPath(path.relative(resolvedRoot, child)),
          content: fs.readFileSync(child, "utf8"),
        });
      }
    }
  };

  for (const root of roots) {
    const absoluteRoot = path.resolve(resolvedRoot, root);
    const relative = path.relative(resolvedRoot, absoluteRoot);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`complexity root escapes repository: ${root}`);
    }
    if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
      throw new Error(`complexity root is not a directory: ${root}`);
    }
    visit(absoluteRoot);
  }
  return files;
}

function parseArguments(argv) {
  const options = { repoRoot: process.cwd(), policyPath: undefined, reportJson: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--report-json") options.reportJson = true;
    else if (argument === "--repo-root" && argv[index + 1]) options.repoRoot = path.resolve(argv[++index]);
    else if (argument === "--policy" && argv[index + 1]) options.policyPath = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  options.policyPath = options.policyPath
    ? path.resolve(options.repoRoot, options.policyPath)
    : path.join(options.repoRoot, "config", "development-gates.json");
  return options;
}

function runCli() {
  const options = parseArguments(process.argv.slice(2));
  const document = JSON.parse(fs.readFileSync(options.policyPath, "utf8"));
  const policy = validatePolicy(document.complexity);
  const files = collectFiles(options.repoRoot, policy.roots);
  const actual = analyzeComplexityDebt(files, policy);
  if (options.reportJson) {
    process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
    return;
  }

  const errors = compareBaseline(actual, policy.baseline);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`complexity: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`complexity: passed (${actual.length} debt file(s))\n`);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`complexity: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
