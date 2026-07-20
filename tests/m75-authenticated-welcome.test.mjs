import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readSource(relativePath) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const projectSyncSource = readSource("src/hooks/useWorkbenchProjectSync.ts");
const projectActionsSource = readSource("src/hooks/useWorkbenchProjectActions.ts");
const initialLoader = projectSyncSource.slice(projectSyncSource.indexOf("async function loadInitialState()"));
const mediaSource = readSource("src/components/layout/MediaWorkbench.tsx");
const welcomeSource = readSource("src/components/layout/AuthenticatedWelcome.tsx");
const interactiveRowSource = readSource("src/components/ui/interactive-list-row.tsx");
const globalCss = readSource("src/app/globals.css");

test("M75 initializes with only the active project list and never restores a snapshot", () => {
  assert.match(initialLoader, /dataSource\.listProjects\("active"\)/);
  assert.match(initialLoader, /setActiveProjectId\(""\)/);
  assert.match(initialLoader, /setMessages\(\[\]\)/);
  assert.match(initialLoader, /setArtifacts\(\[\]\)/);
  assert.match(initialLoader, /setTurnJobs\(\[\]\)/);
  assert.match(initialLoader, /setLoadState\("ready"\)/);
  assert.doesNotMatch(initialLoader, /localStorage|getProjectSnapshot|nextProjects\[0\]/);
});

test("M75 renders welcome without conversation or artifact rail until a project is active", () => {
  assert.match(mediaSource, /controller\.activeProject \? <ConversationWorkbench[\s\S]*: \([\s\S]*<AuthenticatedWelcome/);
  assert.match(mediaSource, /controller\.activeProject && <ArtifactSidePanel/);
  assert.match(mediaSource, /controller\.activeProject && <div className="hidden w-16/);
  assert.match(mediaSource, /controller\.activeProject && \([\s\S]*openArtifactDrawer\("all"\)/);
  assert.match(mediaSource, /projects=\{controller\.projectView === "active" \? controller\.projects : \[\]\}/);
});

test("M75 welcome uses explicit select and create actions and limits recent projects to four", () => {
  assert.match(welcomeSource, /const recentProjects = projects\.slice\(0, 4\)/);
  assert.match(welcomeSource, /onClick=\{\(\) => onSelectProject\(project\.id\)\}/);
  assert.match(welcomeSource, /onClick=\{\(\) => void onCreateProject\(\)\}/);
  assert.match(mediaSource, /onCreateProject=\{controller\.createProject\}/);
  assert.match(mediaSource, /onSelectProject=\{controller\.selectProject\}/);
  assert.match(mediaSource, /const created = await controller\.createProject\(\);[\s\S]*if \(created\) setProjectSheetOpen\(false\)/);
});

test("M75 has the approved welcome copy, project metadata, and an empty state", () => {
  assert.match(welcomeSource, /欢迎回来，\{displayName\}/);
  assert.match(welcomeSource, /今天想准备哪一节课？/);
  assert.match(welcomeSource, /山海课伴会陪你从教材证据、教案到 PPT 和课堂视频逐步完成。/);
  assert.match(welcomeSource, /开始新的备课/);
  assert.match(welcomeSource, /继续最近项目/);
  assert.match(welcomeSource, /project\.meta\} · \{project\.currentStep/);
  assert.match(welcomeSource, /project\.updatedAt/);
  assert.match(welcomeSource, /recentProjects\.length === 0[\s\S]*还没有进行中的项目/);
});

test("M75 lifecycle views and startup never auto-enter an old conversation", () => {
  const viewLoader = projectActionsSource.slice(projectActionsSource.indexOf("const openProjectView"), projectActionsSource.indexOf("const mutateProjectLifecycle"));
  assert.match(viewLoader, /dataSource\.listProjects\(view\)/);
  assert.match(viewLoader, /clearActiveProject\(\)/);
  assert.doesNotMatch(viewLoader, /localStorage\.getItem|getProjectSnapshot|nextProjects\[0\]|loadProject\(/);
  assert.doesNotMatch(initialLoader, /applySnapshot/);
});

test("M75 loading and errors stay on welcome and animation respects reduced motion", () => {
  assert.match(welcomeSource, /loadState === "loading"/);
  assert.match(welcomeSource, /loadState === "error"/);
  assert.match(globalCss, /@keyframes authenticated-welcome-arrive/);
  assert.match(globalCss, /\[data-authenticated-welcome\] > section/);
  assert.match(globalCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\[data-authenticated-welcome\] > section[\s\S]*animation: none/);
  const welcomeAnimation = globalCss.slice(globalCss.indexOf("@keyframes authenticated-welcome-arrive"), globalCss.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.doesNotMatch(welcomeAnimation, /infinite|particle|confetti/);
});

test("M75 recent project rows use color-only hover and keyboard focus states", () => {
  assert.match(welcomeSource, /<InteractiveListRow/);
  assert.match(interactiveRowSource, /hover:border-\[#b9d8cf\]/);
  assert.match(interactiveRowSource, /hover:bg-\[#eaf5f1\]/);
  assert.doesNotMatch(interactiveRowSource, /translate|scale|before:|hover:shadow/);
  assert.match(interactiveRowSource, /focus-visible:ring-2/);
  assert.match(interactiveRowSource, /group-enabled:group-hover:bg-white/);
  assert.match(interactiveRowSource, /group-hover:text-\[#174d40\]/);
});
