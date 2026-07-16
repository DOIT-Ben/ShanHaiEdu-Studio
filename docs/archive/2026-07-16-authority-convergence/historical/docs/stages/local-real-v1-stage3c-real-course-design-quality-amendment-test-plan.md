# V1 Stage 3C: Real Course Design and Visual Quality Amendment Test Plan

Date: 2026-07-12

Status: planned

## 1. Contract Tests

| ID | Scenario | Expected result |
|---|---|---|
| 3C-Q01 | A PageSpec has a generic ordinal title/job used only by the engineering fixture | `ppt_page_generic_placeholder` with its page locator |
| 3C-Q02 | Two pages use the same normalized teaching job | `ppt_page_teaching_job_duplicate` with both affected locators |
| 3C-Q03 | A real-course 12-page package has distinct jobs, titles, visual events, and editable math responsibilities | package remains valid |
| 3C-Q04 | Model output is requested for `ppt_design` | instruction includes unique page-local learning action, visual event, and editable math requirement |
| 3C-Q04A | A PageSpec requests a hundred-grid mathematical representation | the PPTX contains native editable cells and never serializes the object as text |

## 2. Review Gate Tests

| ID | Scenario | Expected result |
|---|---|---|
| 3C-Q05 | Critic records repeated scene, topic drift, or generated readable text on a page | review artifact is a repair package and has no final-eligible deck package |
| 3C-Q06 | Teacher review submits all pages passed with no findings | only a structurally valid candidate may seal a final-eligible deck package |

## 3. Real Provider Pilot

| ID | Scenario | Expected result |
|---|---|---|
| 3C-Q07 | Generate three or four key samples from the new teacher-material design digest | scene, micro-asset, and composed-sample contact sheets are real files with a complete manifest |
| 3C-Q08 | Human visual check of key samples | reject any text artifact, empty/repeated classroom scene, missing lesson visual, or loss of editable-math safe area |
| 3C-Q09 | New sample digest is approved for the integration-only pilot | only then call the 12-page asset batch |
| 3C-Q10 | Rendered sample page contains a long title, question, and math relationship | title, question, and math stay in separate visible regions with no clipping or collision |

## 4. Non-goals

- This plan does not claim textbook-page provenance where the input is a teacher course brief.
- This plan does not replace genuine teacher sign-off for the invitation release gate.
- This plan does not expand or rework the video workflow.
