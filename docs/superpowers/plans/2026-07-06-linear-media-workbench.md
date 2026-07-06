# Linear Media Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated, runnable ShanHaiEdu linear AI lesson-production workbench frontend in `E:\desktop\shanhai媒体工作台`.

**Architecture:** A Next.js App Router app renders one client-side workbench shell. Data is mock-only and lives in `src\lib\mock-data.ts`; interaction state stays local in `MediaWorkbench`.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, Radix UI primitives, lucide-react.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `src\app\layout.tsx`
- Create: `src\app\page.tsx`
- Create: `src\app\globals.css`

- [x] **Step 1: Create app configuration**

Write package scripts for `dev`, `build`, `start`, and `lint`.

- [x] **Step 2: Add app entry**

Render `MediaWorkbench` from `src\app\page.tsx`.

### Task 2: Data Contract

**Files:**
- Create: `src\lib\types.ts`
- Create: `src\lib\mock-data.ts`
- Create: `src\lib\utils.ts`

- [x] **Step 1: Define project and artifact types**

Create typed status, artifact kind, project, message, and action contracts.

- [x] **Step 2: Add complete mock nodes**

Cover教材证据包、教案、导入视频策划卡、PPT 草稿、图片提示词、视频分镜、最终交付.

### Task 3: UI Primitives

**Files:**
- Create: `src\components\ui\button.tsx`
- Create: `src\components\ui\badge.tsx`
- Create: `src\components\ui\textarea.tsx`
- Create: `src\components\ui\popover.tsx`
- Create: `src\components\ui\sheet.tsx`
- Create: `src\components\ui\tooltip.tsx`
- Create: `src\components\ui\scroll-area.tsx`
- Create: `src\components\ui\select.tsx`

- [x] **Step 1: Wrap Radix primitives**

Create small shadcn-style wrappers with local token classes.

### Task 4: Workbench Components

**Files:**
- Create: `src\components\layout\MediaWorkbench.tsx`
- Create: `src\components\layout\ProjectSidebar.tsx`
- Create: `src\components\conversation\ConversationWorkbench.tsx`
- Create: `src\components\conversation\PromptComposer.tsx`
- Create: `src\components\artifacts\ArtifactRail.tsx`
- Create: `src\components\artifacts\ArtifactNodeCard.tsx`
- Create: `src\components\artifacts\ArtifactDetailSheet.tsx`

- [x] **Step 1: Build three-column desktop layout**

Use 256px project sidebar, flexible main area, and 360px artifact rail.

- [x] **Step 2: Build narrow layout**

Collapse project sidebar and move artifacts into a sheet.

- [x] **Step 3: Add core interactions**

Implement copy, use as input, detail, confirm, regenerate, and recovery states.

### Task 5: Verification

**Files:**
- No new files required.

- [ ] **Step 1: Install dependencies**

Run: `npm install`

- [ ] **Step 2: Build**

Run: `npm run build`

- [ ] **Step 3: Browser check**

Run: `npm run dev`, open the local URL, inspect desktop and mobile widths.

