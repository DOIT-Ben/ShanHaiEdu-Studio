import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("小酷偏好、消息标签和本地升级拥有可追溯的真实合同", () => {
  const schema = readSource("prisma/schema.prisma");
  const initSchema = readSource("scripts/init-sqlite-schema.mjs");
  const route = readSource("src/app/api/workbench/projects/[projectId]/messages/[messageId]/reaction/route.ts");
  const controller = readSource("src/hooks/useWorkbenchController.ts");
  const actions = readSource("src/components/conversation/messages/MessageActions.tsx");
  const preferences = readSource("src/lib/xiaoku-preferences.ts");

  assert.match(schema, /model MessageReaction/);
  assert.match(schema, /@@unique\(\[messageId, createdByUserId\]\)/);
  assert.match(initSchema, /CREATE TABLE IF NOT EXISTS "MessageReaction"/);
  assert.match(route, /service\.setMessageReaction/);
  assert.match(controller, /dataSource\.setMessageReaction/);
  assert.match(actions, /aria-pressed=\{reaction === "helpful"\}/);
  assert.match(actions, /aria-pressed=\{reaction === "unhelpful"\}/);
  assert.match(actions, /已复制/);
  assert.match(preferences, /"concise" \| "pragmatic"/);
  assert.match(preferences, /简洁直接/);
  assert.match(preferences, /务实展开/);
});
