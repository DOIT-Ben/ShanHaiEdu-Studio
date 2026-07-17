import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const EXPECT_MATCHERS = new Set([
  "toBe",
  "toContain",
  "toEqual",
  "toMatch",
  "toMatchInlineSnapshot",
  "toStrictEqual",
]);
const ASSERT_MATCHERS = new Set([
  "deepEqual",
  "doesNotMatch",
  "equal",
  "match",
  "notDeepEqual",
  "notEqual",
  "notStrictEqual",
  "ok",
  "strictEqual",
]);

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
    throw new Error("sourceStringContracts policy must be an object");
  }
  if (!isNonEmptyStringArray(policy.roots)) {
    throw new Error("sourceStringContracts policy.roots must be a non-empty string array");
  }
  if (!Array.isArray(policy.excludedPaths) || !policy.excludedPaths.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error("sourceStringContracts policy.excludedPaths must be a string array");
  }
  if (!isNonEmptyStringArray(policy.implementationMarkers)) {
    throw new Error("sourceStringContracts policy.implementationMarkers must be a non-empty string array");
  }
  if (!Array.isArray(policy.baseline)) {
    throw new Error("sourceStringContracts policy.baseline must be an array");
  }

  const seen = new Set();
  const baseline = policy.baseline.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`sourceStringContracts baseline[${index}] must be an object`);
    }
    const entryPath = validateRepoRelativePath(entry.path, `sourceStringContracts baseline[${index}].path`);
    if (!Number.isInteger(entry.occurrences) || entry.occurrences <= 0) {
      throw new Error(`sourceStringContracts baseline[${index}].occurrences must be a positive integer`);
    }
    if (seen.has(entryPath)) {
      throw new Error(`sourceStringContracts baseline contains duplicate path: ${entryPath}`);
    }
    seen.add(entryPath);
    return { path: entryPath, occurrences: entry.occurrences };
  });

  return {
    roots: policy.roots.map((root, index) => validateRepoRelativePath(root, `sourceStringContracts roots[${index}]`)),
    excludedPaths: policy.excludedPaths.map(normalizeRepoPath),
    implementationMarkers: policy.implementationMarkers.map((marker) => normalizeRepoPath(marker).toLowerCase()),
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

function nodeContains(node, predicate) {
  if (predicate(node)) return true;
  let found = false;
  node.forEachChild((child) => {
    if (!found && nodeContains(child, predicate)) found = true;
  });
  return found;
}

function stringMatchesMarker(value, markers) {
  const normalized = normalizeRepoPath(value).toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  return markers.some((marker) => {
    if (marker.includes("/")) {
      return normalized === marker || normalized.includes(`/${marker}`) || normalized.startsWith(`${marker}/`);
    }
    return segments.includes(marker) || normalized === marker;
  });
}

function nodeContainsImplementationMarker(node, markers, pathVariables) {
  return nodeContains(node, (candidate) => {
    if (ts.isStringLiteralLike(candidate)) {
      return stringMatchesMarker(candidate.text, markers);
    }
    return ts.isIdentifier(candidate) && pathVariables.has(candidate.text);
  });
}

function getCalledName(callExpression) {
  const expression = callExpression.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return undefined;
}

function isStructuredDataParse(node) {
  if (!ts.isCallExpression(node)) return false;
  const calledName = getCalledName(node);
  if (calledName !== "parse" && calledName !== "parseDocument") return false;
  const root = rootIdentifierText(node.expression);
  return ["JSON", "YAML", "yaml"].includes(root);
}

function isFilesystemReadCall(node, markers, pathVariables) {
  if (!ts.isCallExpression(node)) return false;
  const calledName = getCalledName(node);
  if (calledName !== "readFile" && calledName !== "readFileSync") return false;
  return node.arguments.some((argument) => nodeContainsImplementationMarker(argument, markers, pathVariables));
}

function collectPathVariables(sourceFile, markers) {
  const pathVariables = new Set();
  const declarations = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (pathVariables.has(declaration.name.text)) continue;
      if (nodeContainsImplementationMarker(declaration.initializer, markers, pathVariables)) {
        pathVariables.add(declaration.name.text);
        changed = true;
      }
    }
  }
  return pathVariables;
}

function collectTaintedVariables(sourceFile, markers, pathVariables) {
  const assignments = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      assignments.push({ name: node.name.text, value: node.initializer });
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)
    ) {
      assignments.push({ name: node.left.text, value: node.right });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const tainted = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const assignment of assignments) {
      if (tainted.has(assignment.name)) continue;
      const derivesFromImplementationText = !isStructuredDataParse(assignment.value) &&
        nodeContains(assignment.value, (candidate) => (
          isFilesystemReadCall(candidate, markers, pathVariables)
          || (ts.isIdentifier(candidate) && tainted.has(candidate.text))
        ));
      if (derivesFromImplementationText) {
        tainted.add(assignment.name);
        changed = true;
      }
    }
  }
  return tainted;
}

function expressionContainsImplementationText(node, markers, pathVariables, taintedVariables) {
  return nodeContains(node, (candidate) => (
    isFilesystemReadCall(candidate, markers, pathVariables)
    || (ts.isIdentifier(candidate) && taintedVariables.has(candidate.text))
  ));
}

function callChainContainsName(node, expectedName) {
  return nodeContains(node, (candidate) => ts.isCallExpression(candidate) && getCalledName(candidate) === expectedName);
}

function rootIdentifierText(node) {
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : undefined;
}

function isSuspiciousAssertion(callExpression, markers, pathVariables, taintedVariables) {
  const calledName = getCalledName(callExpression);
  const expression = callExpression.expression;

  if (
    calledName
    && EXPECT_MATCHERS.has(calledName)
    && (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
    && callChainContainsName(expression.expression, "expect")
  ) {
    return expressionContainsImplementationText(expression.expression, markers, pathVariables, taintedVariables)
      || callExpression.arguments.some((argument) => (
        expressionContainsImplementationText(argument, markers, pathVariables, taintedVariables)
      ));
  }

  if (ts.isIdentifier(expression) && expression.text === "assert") {
    return callExpression.arguments.some((argument) => (
      expressionContainsImplementationText(argument, markers, pathVariables, taintedVariables)
    ));
  }

  if (
    calledName
    && ASSERT_MATCHERS.has(calledName)
    && (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
    && ["assert", "strictAssert"].includes(rootIdentifierText(expression))
  ) {
    return callExpression.arguments.some((argument) => (
      expressionContainsImplementationText(argument, markers, pathVariables, taintedVariables)
    ));
  }

  return false;
}

function countSourceStringAssertions(file, policy) {
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

  const pathVariables = collectPathVariables(sourceFile, policy.implementationMarkers);
  const taintedVariables = collectTaintedVariables(sourceFile, policy.implementationMarkers, pathVariables);
  let occurrences = 0;
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && isSuspiciousAssertion(node, policy.implementationMarkers, pathVariables, taintedVariables)
    ) {
      occurrences += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return occurrences;
}

export function analyzeSourceStringContracts(files, unvalidatedPolicy) {
  const policy = validatePolicy(unvalidatedPolicy);
  const actual = [];
  for (const file of files) {
    const filePath = validateRepoRelativePath(file.path, "source file path");
    if (!policy.roots.some((root) => isWithinRoot(filePath, root))) continue;
    if (matchesAnyGlob(filePath, policy.excludedPaths)) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;
    if (typeof file.content !== "string") throw new Error(`source file content must be a string: ${filePath}`);

    const occurrences = countSourceStringAssertions({ path: filePath, content: file.content }, policy);
    if (occurrences > 0) actual.push({ path: filePath, occurrences });
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
      errors.push(`New source-string contract debt: ${entry.path} has ${entry.occurrences} occurrence(s)`);
    } else if (expected.occurrences !== entry.occurrences) {
      errors.push(`${entry.path} occurrences changed from ${expected.occurrences} to ${entry.occurrences}; update the code and ratchet policy explicitly`);
    }
  }
  for (const entry of baseline) {
    if (!actualByPath.has(entry.path)) {
      errors.push(`${entry.path} no longer exists in actual debt; remove the stale baseline entry explicitly`);
    }
  }
  return errors;
}

export function evaluateSourceStringContracts(files, unvalidatedPolicy) {
  const policy = validatePolicy(unvalidatedPolicy);
  const actual = analyzeSourceStringContracts(files, policy);
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
      throw new Error(`sourceStringContracts root escapes repository: ${root}`);
    }
    if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
      throw new Error(`sourceStringContracts root is not a directory: ${root}`);
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
  const policy = validatePolicy(document.sourceStringContracts);
  const files = collectFiles(options.repoRoot, policy.roots);
  const actual = analyzeSourceStringContracts(files, policy);
  if (options.reportJson) {
    process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
    return;
  }

  const errors = compareBaseline(actual, policy.baseline);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`source-contracts: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`source-contracts: passed (${actual.length} debt file(s))\n`);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`source-contracts: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
