import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("desktop rail renders grouped fixed entries with accessible tooltip status", () => {
  const source = readSource("src/components/artifacts/ArtifactRail.tsx");
  assert.match(source, /groups\.map\(\(group\)/);
  assert.match(source, /<Tooltip key=\{group\.id\}>/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /group\.items\.length/);
  assert.match(source, /group\.attentionCount/);
  assert.match(source, /h-11 w-11/);
  assert.match(source, /全部产物/);
  assert.doesNotMatch(source, /visibleItems\.map[\s\S]*variant !== "drawer"/);
  assert.doesNotMatch(source, /absolute bottom-8 left-1\/2 top-8/);
});

test("group activation supports direct reading and grouped drawer", () => {
  const rail = readSource("src/components/artifacts/ArtifactRail.tsx");
  const workbench = readSource("src/components/layout/MediaWorkbench.tsx");
  assert.match(rail, /getArtifactGroupActivation\(groupItems\)/);
  assert.match(rail, /activation\.mode === "direct"/);
  assert.match(rail, /onOpen\(activation\.item\)/);
  assert.match(rail, /onOpenGroup\?\.\(groupId\)/);
  assert.match(workbench, /onOpenGroup=\{openArtifactDrawer\}/);
  assert.match(workbench, /initialGroup=\{artifactDrawerGroup\}/);
});

test("drawer uses capability chips, quiet rows, and complete empty states", () => {
  const rail = readSource("src/components/artifacts/ArtifactRail.tsx");
  const node = readSource("src/components/artifacts/ArtifactNodeCard.tsx");
  const workbench = readSource("src/components/layout/MediaWorkbench.tsx");
  assert.match(rail, />备课成果</);
  assert.match(rail, /按能力筛选备课成果/);
  assert.match(rail, /<FilterChip/);
  assert.match(rail, /还没有备课成果/);
  assert.match(rail, /暂无\$\{filterLabel/);
  assert.match(node, /<Icon className="h-4 w-4"/);
  assert.doesNotMatch(node, /h-2 w-2 shrink-0 rounded-full/);
  assert.doesNotMatch(`${rail}\n${workbench}`, /线性产物/);
});

test("preview has one primary reading action while real secondary callbacks remain wired", () => {
  const preview = readSource("src/components/artifacts/ArtifactPreviewCard.tsx");
  const side = readSource("src/components/artifacts/ArtifactSidePanel.tsx");
  const detail = readSource("src/components/artifacts/ArtifactDetailSheet.tsx");
  assert.match(preview, /打开阅读/);
  assert.equal((preview.match(/<Button/g) ?? []).length, 1);
  assert.match(preview, /onOpen\(item\)/);
  for (const source of [side, detail]) {
    assert.match(source, /onCopy/);
    assert.match(source, /onUseAsInput/);
    assert.match(source, /ArtifactDownloadActions/);
  }
  assert.doesNotMatch(readSource("src/components/artifacts/ArtifactRail.tsx"), /onRegenerate/);
});

test("artifact detail can return to its originating drawer without changing close semantics", () => {
  const workbench = readSource("src/components/layout/MediaWorkbench.tsx");
  const detail = readSource("src/components/artifacts/ArtifactDetailSheet.tsx");

  assert.match(workbench, /detailFromArtifactDrawer/);
  assert.match(workbench, /openDetailFromRail[\s\S]*setDetailFromArtifactDrawer\(true\)/);
  assert.match(workbench, /openDetailFromReading[\s\S]*setDetailFromArtifactDrawer\(false\)/);
  assert.match(workbench, /returnToArtifactDrawer[\s\S]*setDetailOpen\(false\)[\s\S]*setRailOpen\(true\)/);
  assert.match(workbench, /onBack=\{detailFromArtifactDrawer \? returnToArtifactDrawer : undefined\}/);
  assert.match(detail, /返回备课成果/);
  assert.match(detail, /<ArrowLeft/);
});
