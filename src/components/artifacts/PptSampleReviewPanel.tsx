"use client";

import Image from "next/image";
import { Download, Send } from "lucide-react";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { ArtifactItem, PptSampleReviewSubmission } from "@/lib/types";
import { Button } from "@/components/ui/button";

type PageReview = { design: boolean; visual: boolean; provenance: boolean; findings: string };
type OverviewKind = "scene_and_primary_props" | "micro_assets" | "assembled_samples";

export function PptSampleReviewPanel({ projectId, item, onSubmit }: {
  projectId: string;
  item: ArtifactItem;
  onSubmit: (item: ArtifactItem, review: PptSampleReviewSubmission) => Promise<void>;
}) {
  const sample = item.pptSampleReview;
  if (!sample || !item.artifactId) return null;
  return <PptSampleReviewForm key={`${item.artifactId}:${sample.candidateDigest}`} projectId={projectId} artifactId={item.artifactId} item={item} onSubmit={onSubmit} />;
}

function PptSampleReviewForm({ projectId, artifactId, item, onSubmit }: {
  projectId: string;
  artifactId: string;
  item: ArtifactItem;
  onSubmit: (item: ArtifactItem, review: PptSampleReviewSubmission) => Promise<void>;
}) {
  const sample = item.pptSampleReview!;
  const [reviews, setReviews] = useState<Record<string, PageReview>>(() => buildReviews(sample));
  const [submitting, setSubmitting] = useState(false);
  const readOnly = item.status === "approved";
  const canSubmit = useMemo(() => Boolean(!readOnly && sample?.pageIds.length && sample.pageIds.every((pageId) => {
    const review = reviews[pageId];
    if (!review) return false;
    return review.design && review.visual && review.provenance ? !review.findings.trim() : Boolean(review.findings.trim());
  })), [readOnly, reviews, sample]);
  const evidenceBase = `/api/workbench/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/ppt-sample-evidence`;
  async function submit() {
    if (!sample || !canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(item, {
        candidateDigest: sample.candidateDigest,
        reviewSource: "teacher",
        qa: sample.pageIds.map((pageId) => ({
          pageId,
          design: reviews[pageId].design ? "passed" : "failed",
          visual: reviews[pageId].visual ? "passed" : "failed",
          provenance: reviews[pageId].provenance ? "passed" : "failed",
          findings: reviews[pageId].findings.trim() ? [reviews[pageId].findings.trim()] : [],
        })),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mb-5 border-b border-[#e3ece9] pb-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{readOnly ? "关键样张审查结果" : "关键样张审查"}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{readOnly ? "当前样张已经确认；如需修改，请从调整后重做进入新版本。" : "逐页核对；未通过时写明需要调整的对象或位置。"}</p>
        </div>
        <Button variant="secondary" size="sm" asChild>
          <a href={`${evidenceBase}?kind=pptx`} download><Download className="h-4 w-4" />样张文件</a>
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {sample.overviewKinds.map((kind) => (
          <figure key={kind} className="overflow-hidden rounded-md border border-[#dfe8e5] bg-white">
            <div className="relative aspect-video w-full">
              <Image fill unoptimized sizes="180px" className="object-contain" src={`${evidenceBase}?kind=overview&id=${encodeURIComponent(kind)}`} alt={overviewLabel(kind)} />
            </div>
            <figcaption className="border-t border-[#edf2f0] px-2 py-1.5 text-xs text-muted-foreground">{overviewLabel(kind)}</figcaption>
          </figure>
        ))}
      </div>

      <div className="space-y-3">
        {sample.pageIds.map((pageId, index) => {
          const review = reviews[pageId] ?? emptyReview();
          return (
            <div key={pageId} className="grid gap-3 rounded-md border border-[#dfe8e5] bg-white p-3 sm:grid-cols-[160px_1fr]">
              <div className="relative aspect-video w-full overflow-hidden rounded border border-[#edf2f0]">
                <Image fill unoptimized sizes="160px" className="object-contain" src={`${evidenceBase}?kind=page&id=${encodeURIComponent(pageId)}`} alt={`关键样张 ${index + 1}`} />
              </div>
              <div className="min-w-0">
                <div className="mb-2 text-sm font-medium">样张 {index + 1}</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(["design", "visual", "provenance"] as const).map((field) => (
                    <label key={field} className="flex min-h-8 items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#32685d]"
                        disabled={readOnly}
                        checked={review[field]}
                        onChange={(event) => updatePage(setReviews, pageId, field, event.target.checked)}
                      />
                      {field === "design" ? "设计符合" : field === "visual" ? "画面合格" : "来源可信"}
                    </label>
                  ))}
                </div>
                <textarea
                  value={review.findings}
                  disabled={readOnly}
                  onChange={(event) => updatePage(setReviews, pageId, "findings", event.target.value)}
                  placeholder={review.design && review.visual && review.provenance ? "" : "写明需要调整的对象或位置"}
                  className="mt-2 min-h-16 w-full resize-y rounded-md border border-[#d8e2df] bg-[#fcfdfd] px-3 py-2 text-xs leading-5 outline-none focus:border-[#32685d]"
                />
              </div>
            </div>
          );
        })}
      </div>
      {!readOnly && <div className="mt-3 flex justify-end">
        <Button disabled={!canSubmit || submitting} onClick={() => void submit()}><Send className="h-4 w-4" />{submitting ? "正在提交" : "提交逐页审查"}</Button>
      </div>}
    </section>
  );
}

function overviewLabel(kind: OverviewKind) {
  if (kind === "scene_and_primary_props") return "场景与主教具";
  if (kind === "micro_assets") return "关键小素材";
  return "正式组装样张";
}

function emptyReview(): PageReview {
  return { design: false, visual: false, provenance: false, findings: "" };
}

function buildReviews(sample: NonNullable<ArtifactItem["pptSampleReview"]>): Record<string, PageReview> {
  return Object.fromEntries(sample.pageIds.map((pageId) => {
    const previous = sample.qa?.find((entry) => entry.pageId === pageId);
    return [pageId, previous ? {
      design: previous.design === "passed",
      visual: previous.visual === "passed",
      provenance: previous.provenance === "passed",
      findings: previous.findings.join("；"),
    } : emptyReview()];
  }));
}

function updatePage(setReviews: Dispatch<SetStateAction<Record<string, PageReview>>>, pageId: string, field: keyof PageReview, value: boolean | string) {
  setReviews((current) => ({ ...current, [pageId]: { ...(current[pageId] ?? emptyReview()), [field]: value } }));
}
