import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WORKBENCH_ROUTE_MODULE = "@/server/auth/workbench-route";
const WORKBENCH_ACTOR_WRAPPER = "withLocalWorkbenchActor";
const OPERATION_REGISTRY_PATH = fileURLToPath(new URL("../../config/orchestration-write-operations.json", import.meta.url));

export const EXPECTED_ORCHESTRATION_WRITE_OPERATIONS = Object.freeze(loadExpectedOperations());

export function evaluateOrchestrationAuditGate({ root = process.cwd() } = {}) {
  const repoRoot = path.resolve(root);
  const routesRoot = path.join(repoRoot, "src", "app", "api", "workbench", "projects");
  const operations = collectRouteFiles(routesRoot)
    .flatMap((filePath) => analyzeRouteFile({ filePath, routesRoot, repoRoot }))
    .sort(compareOperations);
  const errors = [];
  const expected = new Set(EXPECTED_ORCHESTRATION_WRITE_OPERATIONS);
  const discovered = new Map();

  for (const operation of operations) {
    const key = operationKey(operation);
    const duplicates = discovered.get(key) ?? [];
    duplicates.push(operation);
    discovered.set(key, duplicates);
    if (!expected.has(key)) errors.push(`Unknown write operation: ${key} (${operation.filePath}).`);
    if (!operation.handlerResolved) errors.push(`${key} does not resolve to a local route handler (${operation.filePath}).`);
    if (!operation.fullyWrappedByWorkbenchActor) {
      errors.push(`${key} must return ${WORKBENCH_ACTOR_WRAPPER} as its outer handler boundary, imported from ${WORKBENCH_ROUTE_MODULE} (${operation.filePath}).`);
    }
  }

  for (const [key, matches] of discovered) {
    if (matches.length > 1) errors.push(`Duplicate write operation export: ${key}.`);
  }
  for (const key of expected) {
    if (!discovered.has(key)) errors.push(`Missing registered write operation: ${key}.`);
  }

  return { ok: errors.length === 0, operations, errors };
}

function collectRouteFiles(routesRoot) {
  if (!fs.existsSync(routesRoot)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && /^route\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(entry.name)) files.push(absolutePath);
    }
  };
  visit(routesRoot);
  return files.sort(compareText);
}

function analyzeRouteFile({ filePath, routesRoot, repoRoot }) {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const wrapperBindings = collectWorkbenchActorWrapperBindings(sourceFile);
  const localDeclarations = collectLocalDeclarations(sourceFile);
  const exportedHandlers = collectUnsafeExports(sourceFile, localDeclarations);
  const routeTemplate = routeTemplateForFile(filePath, routesRoot);
  const relativePath = normalizeRepoPath(path.relative(repoRoot, filePath));

  return exportedHandlers.map(({ method, handler }) => ({
    method,
    routeTemplate,
    filePath: relativePath,
    handlerResolved: Boolean(handler),
    fullyWrappedByWorkbenchActor: Boolean(handler) && returnsImportedWrapper(handler, wrapperBindings),
  }));
}

function collectWorkbenchActorWrapperBindings(sourceFile) {
  const bindings = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== WORKBENCH_ROUTE_MODULE) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === WORKBENCH_ACTOR_WRAPPER) bindings.add(element.name.text);
    }
  }
  return bindings;
}

function collectLocalDeclarations(sourceFile) {
  const declarations = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }
  return declarations;
}

function collectUnsafeExports(sourceFile, localDeclarations) {
  const exported = [];
  for (const statement of sourceFile.statements) {
    if (hasExportModifier(statement)) {
      if (ts.isFunctionDeclaration(statement) && statement.name && UNSAFE_METHODS.has(statement.name.text)) {
        exported.push({ method: statement.name.text, handler: statement });
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && UNSAFE_METHODS.has(declaration.name.text)) {
            exported.push({ method: declaration.name.text, handler: declaration.initializer ?? null });
          }
        }
      }
    }
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      const method = element.name.text;
      if (!UNSAFE_METHODS.has(method)) continue;
      const localName = element.propertyName?.text ?? method;
      exported.push({ method, handler: statement.moduleSpecifier ? null : localDeclarations.get(localName) ?? null });
    }
  }
  return exported;
}

function returnsImportedWrapper(handler, wrapperBindings) {
  if (wrapperBindings.size === 0) return false;
  const body = ts.isFunctionLike(handler) ? handler.body : handler;
  if (!body) return false;
  if (!ts.isBlock(body)) return isImportedWrapperCall(body, wrapperBindings);
  if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0]) || !body.statements[0].expression) return false;
  return isImportedWrapperCall(body.statements[0].expression, wrapperBindings);
}

function isImportedWrapperCall(expression, wrapperBindings) {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current)) current = current.expression;
  return ts.isCallExpression(current)
    && ts.isIdentifier(current.expression)
    && wrapperBindings.has(current.expression.text);
}

function loadExpectedOperations() {
  const registry = JSON.parse(fs.readFileSync(OPERATION_REGISTRY_PATH, "utf8"));
  if (!Array.isArray(registry) || registry.length === 0) throw new Error("Orchestration operation registry must be a non-empty array.");
  const operations = registry.map((entry, index) => {
    if (!entry || typeof entry !== "object" || !UNSAFE_METHODS.has(entry.method)
      || typeof entry.routeTemplate !== "string" || !entry.routeTemplate.startsWith("/api/workbench/projects")) {
      throw new Error(`Invalid orchestration operation registry entry at index ${index}.`);
    }
    return `${entry.method} ${entry.routeTemplate}`;
  });
  if (new Set(operations).size !== operations.length) throw new Error("Orchestration operation registry contains duplicate method and route entries.");
  return operations;
}

function hasExportModifier(node) {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function routeTemplateForFile(filePath, routesRoot) {
  const relativeDirectory = path.relative(routesRoot, path.dirname(filePath));
  const segments = relativeDirectory === "" ? [] : relativeDirectory.split(path.sep);
  const routeSegments = segments.map((segment) => {
    const match = /^\[([^\]]+)\]$/.exec(segment);
    if (!match) return segment;
    return `:${match[1].replace(/^\.\.\./, "")}`;
  });
  return ["", "api", "workbench", "projects", ...routeSegments].join("/");
}

function operationKey(operation) {
  return `${operation.method} ${operation.routeTemplate}`;
}

function compareOperations(left, right) {
  return compareText(operationKey(left), operationKey(right)) || compareText(left.filePath, right.filePath);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRepoPath(value) {
  return value.replaceAll("\\", "/");
}

function parseArguments(argv) {
  let root = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--repo-root" && argv[index + 1]) root = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  return { root };
}

function runCli() {
  const result = evaluateOrchestrationAuditGate(parseArguments(process.argv.slice(2)));
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`orchestration-audit: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`orchestration-audit: passed (${result.operations.length} write operation(s))\n`);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`orchestration-audit: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
