# V1 Stage 3C: Real Course Design and Visual Quality Amendment Plan

Date: 2026-07-12

Status: planned

Related requirement: `RQ-024 PPT Quality end-to-end loop`

## 1. Trigger and Decision

The first real-provider full-deck integration run produced a structurally valid 12-page PPTX, PDF, page PNGs, and contact sheet. Visual inspection rejected it: it used a test fixture whose page titles, teaching actions, and scene prompts were generic placeholders. The output was a repeated empty-classroom series with generated text artifacts, not a usable lesson deck.

This is a production-input defect, not a rendering success and not a provider outage. The run remains `real_provider_integration_test_only`; it must not close `RQ-024`, become `final_eligible`, or be described as teacher-approved courseware.

## 2. Scope

1. Reject known placeholder/generic PageSpecs and duplicate page teaching jobs before any image-provider request.
2. Strengthen the PPT-design runtime instruction so every page has a distinct learning action, visual event, AI visual responsibility, editable math responsibility, and readable teacher-facing title.
3. Preserve the existing non-linear Agent model: these are contracts on the `ppt_design` artifact and PPT quality tools, not a fixed top-level workflow.
4. Run a new real-course pilot from a teacher-approved course brief. The source type is explicitly `teacher_material`, because no versioned textbook PDF is currently available. It must not claim a textbook page reference.
5. Run key samples before full production. A human visual review must reject topic drift, repeated scenes, unreadable/generated text, missing visual events, or incorrect math responsibility; only a newly approved sample digest may unlock full assets.

## 3. Real Course Pilot Boundary

The pilot topic is Grade 5 mathematics, `百分数的意义`, based only on this approved course brief:

- Scope: understand that a percentage describes how many parts out of one hundred; connect part-whole comparison to percent notation and everyday contexts.
- Do not teach percentage-fraction/decimal conversion algorithms, discount calculation procedures, or answers embedded in generated imagery.
- Required page progression: curiosity -> establish comparison unit -> hundred-grid representation -> meaning statement -> read/write -> real-life interpretation -> comparison -> misconception check -> transfer task -> summary.
- Exact numerical examples, percent signs, relation arrows, grids, prompts, and answers are editable PowerPoint layers. AI images provide scenes, tangible objects, material, and spatial context only.

The brief is sufficient for an auditable product pilot, but is not a replacement for a textbook-evidence acceptance test. A later textbook-backed task must still validate page-level source citations.

## 4. Implementation Boundaries

- Do not weaken the existing `PptDesignPackage`, provenance, sample approval, render, or page-repair gates.
- Do not mark a deterministic heuristic as a visual critic. It only rejects known generic design input before spend.
- Do not convert AI generated scenes into mathematical evidence. All exact content remains in `EDITABLE_TEXT` or `EDITABLE_MATH`.
- Do not reuse the rejected integration assets or approval digest for the pilot.
- Do not make a simulated test review appear as teacher sign-off. Test review evidence must be labelled `integration_test_only`.

## 5. Acceptance Criteria

1. The old `validPptDesignPackage()` fixture is rejected for real asset production because it contains generic placeholder PageSpecs.
2. A meaningful package with 12 distinct page jobs passes the same validator.
3. Runtime instructions prohibit generic page titles/jobs and require page-local visual/mathematical responsibilities.
4. A critic-style failed review stores page-level findings and cannot create `PptFullDeckPackage.finalEligible`.
5. A new real-course design package is produced from the course brief, validated, and used for a new key-sample-only run before any new full batch.
6. The sample contact sheet is visually inspected. It only proceeds to all 12 pages after the new digest is explicitly approved for this test run.

## 6. Verification

```powershell
npx vitest run tests/ppt-quality-design-contract.test.ts tests/ppt-full-deck-review-persistence.test.ts tests/agent-runtime/openai-runtime.test.ts
npx tsc --noEmit
npm run build
git diff --check
```

The real course pilot additionally requires the actual manifest, generated files, PPTX slide count, PDF/page render count, visual inspection screenshots, and a provenance-labelled closeout. The visual review cannot be substituted by test assertions.
