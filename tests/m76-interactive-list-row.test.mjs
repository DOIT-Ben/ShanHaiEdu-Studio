import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const row = readSource("src/components/ui/interactive-list-row.tsx");
const welcome = readSource("src/components/layout/AuthenticatedWelcome.tsx");
const projects = readSource("src/components/layout/ProjectListItem.tsx");
const artifacts = readSource("src/components/artifacts/ArtifactNodeCard.tsx");
const members = readSource("src/components/admin/ProjectMembersDialog.tsx");
const users = readSource("src/components/admin/AdminUserManagementDialog.tsx");
const feedback = readSource("src/components/feedback/FeedbackDialog.tsx");
const profileMenu = readSource("src/components/layout/ProfileMenu.tsx");
const css = readSource("src/app/globals.css");

test("M76 exposes a small native-button list-row contract", () => {
  assert.match(row, /ButtonHTMLAttributes<HTMLButtonElement>/);
  for (const prop of ["active", "selected", "attention", "leading", "title", "subtitle", "meta", "trailing", "showArrow", "disabled", "className"]) {
    assert.match(row, new RegExp(`${prop}[?=:]`));
  }
  assert.match(row, /<button/);
  assert.match(row, /min-h-11/);
});

test("M76 keeps color-only interaction and accessible states", () => {
  assert.match(row, /enabled:hover:bg-\[#eaf5f1\]/);
  assert.match(row, /enabled:hover:border-\[#b9d8cf\]/);
  assert.doesNotMatch(row, /translate|scale|before:|hover:shadow|shadow-\[/);
  assert.match(row, /group-hover:text-\[#174d40\]/);
  assert.match(row, /<ArrowRight/);
  assert.match(row, /active:bg-\[#deeee8\]/);
  assert.match(row, /focus-visible:ring-2/);
});

test("M76 selected, attention, disabled, and contained contracts are explicit", () => {
  assert.match(row, /const isSelected = active \|\| selected/);
  assert.match(row, /data-selected=/);
  assert.match(row, /attention && "border-\[#e5c7c1\] bg-\[#fff7f5\]"/);
  assert.match(row, /disabled:cursor-default/);
  assert.match(row, /contained && "max-w-full"/);
  assert.doesNotMatch(css, /\[data-interactive-list-row\]/);
});

test("M76 migrates only the three approved object-selection rows", () => {
  assert.match(welcome, /<InteractiveListRow[\s\S]*showArrow/);
  assert.match(projects, /<InteractiveListRow[\s\S]*active=\{active\}[\s\S]*rounded-r-none/);
  assert.match(artifacts, /variant === "drawer"[\s\S]*<InteractiveListRow[\s\S]*selected=\{active\}/);
  const railBranch = artifacts.slice(artifacts.lastIndexOf("  return ("));
  assert.doesNotMatch(railBranch, /InteractiveListRow/);
  assert.match(railBranch, /<button/);
});

test("M76 preserves independent project actions and avoids mechanical migration", () => {
  assert.match(projects, /grid-cols-\[minmax\(0,1fr\)_68px\]/);
  assert.doesNotMatch(projects, /absolute right-2 top-1/);
  assert.match(projects, /items-stretch overflow-hidden rounded-lg/);
  assert.doesNotMatch(projects, /border-l border-transparent/);
  assert.match(projects, /rounded-r-none/);
  assert.match(projects, /aria-label="项目操作"/);
  assert.match(projects, /request\("archive"\)/);
  assert.match(projects, /request\("trash"\)/);
  for (const source of [members, users, feedback, profileMenu]) {
    assert.doesNotMatch(source, /InteractiveListRow/);
  }
});
