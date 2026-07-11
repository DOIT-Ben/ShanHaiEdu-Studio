import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file) => readFileSync(path.join(process.cwd(), file), "utf8");
function allTsx(dir) {
  return readdirSync(dir).flatMap((name) => {
    const target = path.join(dir, name);
    return statSync(target).isDirectory() ? allTsx(target) : target.endsWith(".tsx") ? [target] : [];
  });
}

const row = read("src/components/ui/interactive-list-row.tsx");
const projects = read("src/components/layout/ProjectListItem.tsx");
const select = read("src/components/ui/select.tsx");
const css = read("src/app/globals.css");

test("M78 object rows and project surface use color-only interaction", () => {
  assert.doesNotMatch(row, /translate|scale|before:|hover:shadow|shadow-\[/);
  assert.match(row, /transition-\[background-color,border-color,color\]/);
  assert.doesNotMatch(projects, /hover:shadow|border-l|divide-x/);
  assert.match(projects, /grid-cols-\[minmax\(0,1fr\)_68px\]/);
});

test("M78 removes global button movement and keeps semantic surface tokens", () => {
  assert.doesNotMatch(css, /button:active[\s\S]*transform/);
  for (const token of ["--surface-border", "--surface-radius", "--focus-ring", "--shadow-popover", "--shadow-dialog"]) assert.match(css, new RegExp(token));
});

test("M78 select has one Popper, disabled, scrolling, and narrow-screen contract", () => {
  assert.match(select, /position = "popper"/);
  assert.match(select, /sideOffset = 6/);
  assert.match(select, /disabled:cursor-not-allowed/);
  assert.match(select, /overflow-y-auto/);
  assert.match(select, /max-w-\[calc\(100vw-16px\)\]/);
  const source = allTsx(path.join(process.cwd(), "src")).map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /<select\b/);
});

test("M78 migrates ordinary inputs and preserves special composer/file inputs", () => {
  for (const file of ["src/components/auth/PasswordAuthGate.tsx", "src/components/admin/ProjectMembersDialog.tsx", "src/components/admin/AdminUserManagementDialog.tsx", "src/components/feedback/FeedbackDialog.tsx", "src/components/layout/ProjectListItem.tsx", "src/components/layout/ProjectSidebar.tsx"]) assert.match(read(file), /<Input\b/);
  assert.match(read("src/components/feedback/FeedbackDialog.tsx"), /<Textarea\b[\s\S]*data-feedback-description[\s\S]*<Textarea\b[\s\S]*data-feedback-expected-effect/);
  assert.match(read("src/components/conversation/PromptComposer.tsx"), /<input[\s\S]*type="file"[\s\S]*<Textarea/);
  assert.match(read("src/components/feedback/FeedbackDialog.tsx"), /<input[\s\S]*type="file"/);
});

test("M78 MenuItem and neutral close labels are wired", () => {
  for (const file of ["src/components/layout/ProfileMenu.tsx", "src/components/layout/ProjectListItem.tsx", "src/components/conversation/PromptComposer.tsx"]) assert.match(read(file), /<MenuItem\b/);
  assert.match(read("src/components/ui/dialog.tsx"), /aria-label="关闭"/);
  assert.doesNotMatch(read("src/components/ui/dialog.tsx"), /关闭反馈/);
  assert.match(read("src/components/ui/sheet.tsx"), /aria-label="关闭"/);
});
