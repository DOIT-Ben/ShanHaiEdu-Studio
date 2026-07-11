import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file) => readFileSync(path.join(process.cwd(), file), "utf8");
const select = read("src/components/ui/select.tsx");
const members = read("src/components/admin/ProjectMembersDialog.tsx");
const users = read("src/components/admin/AdminUserManagementDialog.tsx");

test("M77 uses one branded select interaction contract", () => {
  assert.match(select, /data-\[state=open\]:border-\[#7fcfc1\]/);
  assert.match(select, /group-data-\[state=open\]:rotate-180/);
  assert.match(select, /data-\[highlighted\]:bg-\[#edf7f4\]/);
  assert.match(select, /data-\[state=checked\]:bg-\[#f2f4f3\]/);
  assert.match(select, /data-\[state=checked\]:text-\[#167467\]/);
  assert.match(select, /absolute right-4/);
  assert.match(select, /--radix-select-trigger-width/);
  assert.match(select, /position = "popper"/);
  assert.match(select, /sideOffset = 6/);
  assert.match(select, /align = "start"/);
  assert.match(select, /collisionPadding=\{8\}/);
  assert.match(select, /disabled:cursor-not-allowed/);
  assert.match(select, /max-h-\[min\(320px,var\(--radix-select-content-available-height\)\)\]/);
  assert.match(select, /max-w-\[calc\(100vw-16px\)\]/);
});

test("M77 migrates member permissions and account roles without native selects", () => {
  assert.doesNotMatch(`${members}\n${users}`, /<select/);
  assert.ok((members.match(/<Select /g) ?? []).length >= 2);
  assert.match(members, /value="viewer">可查看/);
  assert.match(members, /value="editor">可编辑/);
  assert.match(users, /value="teacher">教师/);
  assert.match(users, /value="admin">管理员/);
});
