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

function nodeContains(node, predicate) {
  if (predicate(node)) return true;
  let found = false;
  node.forEachChild((child) => {
    if (!found && nodeContains(child, predicate)) found = true;
  });
  return found;
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

function unwrapExpression(node) {
  let current = node;
  while (current) {
    if (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || (typeof ts.isSatisfiesExpression === "function" && ts.isSatisfiesExpression(current))
      || (typeof ts.isNonNullExpression === "function" && ts.isNonNullExpression(current))
      || ts.isAwaitExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    break;
  }
  return current;
}

function lexicalScopeKind(node) {
  if (ts.isSourceFile(node) || ts.isModuleBlock(node) || ts.isFunctionLike(node)) return "var";
  if (ts.isClassLike(node)) return "class";
  if (ts.isBlock(node) || ts.isCatchClause(node)) return "block";
  return undefined;
}

function createLexicalScope(parent, kind = "block") {
  return { parent, bindings: new Map(), kind };
}

function nearestVarScope(scope) {
  let current = scope;
  while (current?.parent && current.kind !== "var") current = current.parent;
  return current;
}

function getOrCreateBinding(scope, name) {
  let binding = scope.bindings.get(name);
  if (!binding) {
    binding = {
      name,
      initializers: [],
      assignments: [],
      functions: [],
      projections: [],
      scope,
    };
    scope.bindings.set(name, binding);
  }
  return binding;
}

function propertyNameText(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

function bindDeclarationPattern(pattern, initializer, declarationScope, declarations) {
  if (ts.isIdentifier(pattern)) {
    const binding = getOrCreateBinding(declarationScope, pattern.text);
    if (initializer) binding.initializers.push(initializer);
    declarations.set(pattern, binding);
    return;
  }
  if (!ts.isObjectBindingPattern(pattern) && !ts.isArrayBindingPattern(pattern)) return;
  pattern.elements.forEach((element, index) => {
    if (!ts.isBindingElement(element)) return;
    const propertyName = ts.isObjectBindingPattern(pattern)
      ? propertyNameText(element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined))
      : String(index);
    if (ts.isIdentifier(element.name)) {
      const binding = getOrCreateBinding(declarationScope, element.name.text);
      if (initializer && propertyName !== undefined) binding.projections.push({ source: initializer, propertyName });
      if (element.initializer) binding.initializers.push(element.initializer);
      declarations.set(element.name, binding);
      return;
    }
    bindDeclarationPattern(element.name, initializer, declarationScope, declarations);
  });
}

function buildLexicalModel(sourceFile) {
  const root = createLexicalScope(null, "var");
  const nodeScopes = new WeakMap();
  const declarations = new WeakMap();
  const visit = (node, parentScope) => {
    const kind = lexicalScopeKind(node);
    const scope = node === sourceFile ? root : (kind ? createLexicalScope(parentScope, kind) : parentScope);
    nodeScopes.set(node, scope);

    if (ts.isVariableDeclaration(node)) {
      const declarationFlags = node.parent.flags;
      const isVarDeclaration = (declarationFlags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
      const declarationScope = isVarDeclaration ? nearestVarScope(scope) : scope;
      bindDeclarationPattern(node.name, node.initializer, declarationScope, declarations);
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      const binding = getOrCreateBinding(scope, node.name.text);
      if (node.initializer) binding.initializers.push(node.initializer);
      declarations.set(node.name, binding);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      const binding = getOrCreateBinding(parentScope, node.name.text);
      binding.functions.push(node);
      declarations.set(node.name, binding);
    } else if (ts.isImportSpecifier(node)) {
      const binding = getOrCreateBinding(scope, node.name.text);
      binding.importedName = node.propertyName?.text ?? node.name.text;
      declarations.set(node.name, binding);
    }

    ts.forEachChild(node, (child) => visit(child, scope));
  };
  visit(sourceFile, root);

  const assignments = [];
  const collectAssignments = (node) => {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)
    ) {
      assignments.push({ identifier: node.left, value: node.right, scope: nodeScopes.get(node) ?? root });
    }
    ts.forEachChild(node, collectAssignments);
  };
  collectAssignments(sourceFile);
  for (const assignment of assignments) {
    const binding = resolveLexicalBinding(assignment.identifier, assignment.scope);
    if (binding) binding.assignments.push(assignment);
  }

  return { root, nodeScopes, declarations };
}

function resolveLexicalBinding(identifier, scope) {
  let current = scope;
  while (current) {
    const binding = current.bindings.get(identifier.text);
    if (binding) return binding;
    current = current.parent;
  }
  return undefined;
}

function isPropertyNameIdentifier(node) {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isMethodSignature(parent) && parent.name === node)
    || (ts.isPropertySignature(parent) && parent.name === node)
    || (ts.isGetAccessorDeclaration(parent) && parent.name === node)
    || (ts.isSetAccessorDeclaration(parent) && parent.name === node)
    || (ts.isJsxAttribute(parent) && parent.name === node)
    || (ts.isJsxNamespacedName(parent) && (parent.namespace === node || parent.name === node))
    || (ts.isJsxOpeningElement(parent) && parent.tagName === node)
    || (ts.isJsxSelfClosingElement(parent) && parent.tagName === node)
    || (ts.isJsxClosingElement(parent) && parent.tagName === node)
    || (ts.isLabeledStatement(parent) && parent.label === node)
  );
}

function nodePosition(node) {
  const position = node?.getStart?.();
  return Number.isSafeInteger(position) ? position : Number.MAX_SAFE_INTEGER;
}

function exceedsAnalysisDepth(node, maximumDepth = 192) {
  let current = node;
  let depth = 0;
  while (current?.parent) {
    depth += 1;
    if (depth > maximumDepth) return true;
    current = current.parent;
  }
  return false;
}

function memoizedBindingValue(memo, binding, cutoff) {
  const values = memo.get(binding);
  return values?.get(cutoff);
}

function rememberBindingValue(memo, binding, cutoff, value) {
  let values = memo.get(binding);
  if (!values) {
    values = new Map();
    memo.set(binding, values);
  }
  values.set(cutoff, value);
}

function bindingIsActive(active, binding, cutoff) {
  return active.get(binding)?.has(cutoff) === true;
}

function markBindingActive(active, binding, cutoff) {
  let cutoffs = active.get(binding);
  if (!cutoffs) {
    cutoffs = new Set();
    active.set(binding, cutoffs);
  }
  cutoffs.add(cutoff);
}

function clearBindingActive(active, binding, cutoff) {
  const cutoffs = active.get(binding);
  if (!cutoffs) return;
  cutoffs.delete(cutoff);
  if (cutoffs.size === 0) active.delete(binding);
}

function forEachValueChild(node, callback) {
  const current = unwrapExpression(node);
  if (current !== node) {
    callback(current);
    return;
  }
  if (ts.isPropertyAccessExpression(current)) {
    callback(current.expression);
    return;
  }
  if (ts.isElementAccessExpression(current)) {
    callback(current.expression);
    if (current.argumentExpression) callback(current.argumentExpression);
    return;
  }
  if (ts.isPropertyAssignment(current)) {
    callback(current.initializer);
    return;
  }
  if (ts.isShorthandPropertyAssignment(current)) {
    callback(current.name);
    return;
  }
  if (ts.isSpreadAssignment(current)) {
    callback(current.expression);
    return;
  }
  if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
    callback(current.expression);
    for (const argument of current.arguments ?? []) callback(argument);
    return;
  }
  if (ts.isTemplateExpression(current)) {
    for (const span of current.templateSpans) callback(span.expression);
    return;
  }
  current.forEachChild((child) => {
    if (ts.isTypeNode(child) || (ts.isIdentifier(child) && isPropertyNameIdentifier(child))) return;
    callback(child);
  });
}

function isStructuredDataParse(node) {
  const current = unwrapExpression(node);
  if (!ts.isCallExpression(current)) return false;
  const calledName = getCalledName(current);
  if (calledName !== "parse" && calledName !== "parseDocument") return false;
  const root = rootIdentifierText(current.expression);
  return ["JSON", "YAML", "yaml"].includes(root);
}

function propertyAccessName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression) return propertyNameText(node.argumentExpression);
  return undefined;
}

function objectPropertyInitializers(node, propertyName, model, activeBindings = new Set()) {
  const current = unwrapExpression(node);
  if (ts.isObjectLiteralExpression(current)) {
    return current.properties.flatMap((property) => {
      if (ts.isPropertyAssignment(property) && propertyNameText(property.name) === propertyName) return [property.initializer];
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName) return [property.name];
      return [];
    });
  }
  if (ts.isIdentifier(current) && !isPropertyNameIdentifier(current)) {
    const binding = resolveLexicalBinding(current, model.nodeScopes.get(current));
    if (!binding || activeBindings.has(binding)) return [];
    activeBindings.add(binding);
    const values = [
      ...binding.initializers,
      ...binding.assignments.map((assignment) => assignment.value),
    ].flatMap((value) => objectPropertyInitializers(value, propertyName, model, activeBindings));
    activeBindings.delete(binding);
    return values;
  }
  return [];
}

function returnExpressions(functionLike) {
  if (ts.isArrowFunction(functionLike) && !ts.isBlock(functionLike.body)) return [functionLike.body];
  if (!ts.isBlock(functionLike.body)) return [];
  const values = [];
  const visit = (node) => {
    if (exceedsAnalysisDepth(node) || (node !== functionLike && ts.isFunctionLike(node))) return;
    if (ts.isReturnStatement(node) && node.expression) values.push(node.expression);
    ts.forEachChild(node, visit);
  };
  visit(functionLike.body);
  return values;
}

function functionValuesForCallee(node, model) {
  const current = unwrapExpression(node);
  if (ts.isFunctionLike(current)) return [current];
  if (ts.isIdentifier(current) && !isPropertyNameIdentifier(current)) {
    const binding = resolveLexicalBinding(current, model.nodeScopes.get(current));
    if (!binding) return [];
    return [
      ...binding.functions,
      ...binding.initializers.filter((initializer) => ts.isFunctionLike(unwrapExpression(initializer))),
    ];
  }
  if (!ts.isCallExpression(current)) return [];
  return functionValuesForCallee(current.expression, model).flatMap((functionLike) => (
    returnExpressions(functionLike).filter((value) => ts.isFunctionLike(unwrapExpression(value)))
  ));
}

function isFilesystemReadName(callExpression, model) {
  const calledName = getCalledName(callExpression);
  if (calledName === "readFile" || calledName === "readFileSync") return true;
  if (!ts.isIdentifier(callExpression.expression)) return false;
  const binding = resolveLexicalBinding(callExpression.expression, model.nodeScopes.get(callExpression.expression));
  return binding?.importedName === "readFile" || binding?.importedName === "readFileSync";
}

function isFilesystemReadCall(node, markers, model, state) {
  const current = unwrapExpression(node);
  if (!ts.isCallExpression(current)) return false;
  if (!isFilesystemReadName(current, model)) return false;
  return current.arguments.some((argument) => expressionContainsImplementationMarker(argument, markers, model, state));
}

function expressionContainsImplementationMarker(node, markers, model, state) {
  const current = unwrapExpression(node);
  if (!current || exceedsAnalysisDepth(current)) return false;
  if (ts.isStringLiteralLike(current)) return stringMatchesMarker(current.text, markers);
  if (ts.isTemplateExpression(current)) {
    if (stringMatchesMarker(current.head.text, markers)) return true;
    return current.templateSpans.some((span) => (
      stringMatchesMarker(span.literal.text, markers)
      || expressionContainsImplementationMarker(span.expression, markers, model, state)
    ));
  }
  const propertyName = propertyAccessName(current);
  if (propertyName !== undefined && (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))) {
    const values = objectPropertyInitializers(current.expression, propertyName, model);
    if (values.length > 0) {
      return values.some((value) => expressionContainsImplementationMarker(value, markers, model, state));
    }
  }
  if (ts.isIdentifier(current) && !isPropertyNameIdentifier(current)) {
    const binding = resolveLexicalBinding(current, model.nodeScopes.get(current));
    return binding
      ? bindingContainsImplementationMarker(binding, markers, model, state, nodePosition(current))
      : false;
  }
  let found = false;
  forEachValueChild(current, (child) => {
    if (!found && expressionContainsImplementationMarker(child, markers, model, state)) found = true;
  });
  return found;
}

function bindingContainsImplementationMarker(binding, markers, model, state, cutoff = Number.MAX_SAFE_INTEGER) {
  const memoized = memoizedBindingValue(state.markerMemo, binding, cutoff);
  if (memoized !== undefined) return memoized;
  if (bindingIsActive(state.markerActive, binding, cutoff)) return false;
  markBindingActive(state.markerActive, binding, cutoff);
  let result = Boolean(
    binding.initializers.some((initializer) => (
      nodePosition(initializer) <= cutoff &&
      expressionContainsImplementationMarker(initializer, markers, model, state)
    )),
  );
  for (const projection of binding.projections) {
    if (!result) {
      result = objectPropertyInitializers(projection.source, projection.propertyName, model).some((value) => (
        expressionContainsImplementationMarker(value, markers, model, state)
      ));
    }
  }
  for (const assignment of binding.assignments) {
    if (!result && nodePosition(assignment.identifier) < cutoff &&
        expressionContainsImplementationMarker(assignment.value, markers, model, state)) result = true;
  }
  clearBindingActive(state.markerActive, binding, cutoff);
  rememberBindingValue(state.markerMemo, binding, cutoff, result);
  return result;
}

function expressionContainsImplementationTextInner(node, markers, model, state) {
  const current = unwrapExpression(node);
  if (!current || exceedsAnalysisDepth(current) || isStructuredDataParse(current)) return false;
  if (isFilesystemReadCall(current, markers, model, state)) return true;
  const propertyName = propertyAccessName(current);
  if (propertyName !== undefined && (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))) {
    const values = objectPropertyInitializers(current.expression, propertyName, model);
    if (values.length > 0) {
      return values.some((value) => expressionContainsImplementationText(value, markers, model, state));
    }
  }
  if (ts.isCallExpression(current)) {
    const functionValues = functionValuesForCallee(current.expression, model);
    if (functionValues.length > 0) {
      return functionValues.some((functionLike) => (
        returnExpressions(functionLike).some((value) => (
          expressionContainsImplementationText(value, markers, model, state)
        ))
      ));
    }
  }
  if (ts.isIdentifier(current) && !isPropertyNameIdentifier(current)) {
    const binding = resolveLexicalBinding(current, model.nodeScopes.get(current));
    return binding
      ? bindingContainsImplementationText(binding, markers, model, state, nodePosition(current))
      : false;
  }
  let found = false;
  forEachValueChild(current, (child) => {
    if (!found && expressionContainsImplementationText(child, markers, model, state)) found = true;
  });
  return found;
}

function expressionContainsImplementationText(node, markers, model, state) {
  const current = unwrapExpression(node);
  if (!current) return false;
  const tracksNode = !ts.isIdentifier(current);
  if (tracksNode && state.textActiveNodes.has(current)) return false;
  if (tracksNode) state.textActiveNodes.add(current);
  try {
    return expressionContainsImplementationTextInner(current, markers, model, state);
  } finally {
    if (tracksNode) state.textActiveNodes.delete(current);
  }
}

function bindingContainsImplementationText(binding, markers, model, state, cutoff = Number.MAX_SAFE_INTEGER) {
  const memoized = memoizedBindingValue(state.textMemo, binding, cutoff);
  if (memoized !== undefined) return memoized;
  if (bindingIsActive(state.textActive, binding, cutoff)) return false;
  markBindingActive(state.textActive, binding, cutoff);
  let result = Boolean(
    binding.initializers.some((initializer) => (
      nodePosition(initializer) <= cutoff &&
      expressionContainsImplementationText(initializer, markers, model, state)
    )),
  );
  for (const projection of binding.projections) {
    if (!result) {
      result = objectPropertyInitializers(projection.source, projection.propertyName, model).some((value) => (
        expressionContainsImplementationText(value, markers, model, state)
      ));
    }
  }
  for (const assignment of binding.assignments) {
    if (!result && nodePosition(assignment.identifier) < cutoff &&
        expressionContainsImplementationText(assignment.value, markers, model, state)) result = true;
  }
  clearBindingActive(state.textActive, binding, cutoff);
  rememberBindingValue(state.textMemo, binding, cutoff, result);
  return result;
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

function isSuspiciousAssertion(callExpression, markers, model, state) {
  const calledName = getCalledName(callExpression);
  const expression = callExpression.expression;

  if (
    calledName
    && EXPECT_MATCHERS.has(calledName)
    && (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
    && callChainContainsName(expression.expression, "expect")
  ) {
    return expressionContainsImplementationText(expression.expression, markers, model, state)
      || callExpression.arguments.some((argument) => (
        expressionContainsImplementationText(argument, markers, model, state)
      ));
  }

  if (ts.isIdentifier(expression) && expression.text === "assert") {
    return callExpression.arguments.some((argument) => (
      expressionContainsImplementationText(argument, markers, model, state)
    ));
  }

  if (
    calledName
    && ASSERT_MATCHERS.has(calledName)
    && (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
    && ["assert", "strictAssert"].includes(rootIdentifierText(expression))
  ) {
    return callExpression.arguments.some((argument) => (
      expressionContainsImplementationText(argument, markers, model, state)
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

  const model = buildLexicalModel(sourceFile);
  const state = {
    markerActive: new WeakMap(),
    markerMemo: new WeakMap(),
    textActive: new WeakMap(),
    textMemo: new WeakMap(),
    textActiveNodes: new WeakSet(),
  };
  let occurrences = 0;
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && isSuspiciousAssertion(node, policy.implementationMarkers, model, state)
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
