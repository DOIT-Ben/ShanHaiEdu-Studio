"use client";

import Image from "next/image";
import { Download, Send } from "lucide-react";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { ArtifactItem, PptFullDeckReviewSubmission } from "@/lib/types";
import { Button } from "@/components/ui/button";

type PageReview = { design: boolean; visual: boolean; provenance: boolean; readability: boolean; findings: string };

export function PptFullDeckReviewPanel({ projectId, item, onSubmit }: {
  projectId: string;
  item: ArtifactItem;
  onSubmit: (item: ArtifactItem, review: PptFullDeckReviewSubmission) => Promise<void>;
}) {
  const deck = item.pptFullDeckReview;
  if (!deck || !item.artifactId) return null;
  return <PptFullDeckReviewForm key={`${item.artifactId}:${deck.candidateDigest}`} projectId={projectId} artifactId={item.artifactId} item={item} onSubmit={onSubmit} />;
}

function PptFullDeckReviewForm({ projectId, artifactId, item, onSubmit }: {
  projectId: string;
  artifactId: string;
  item: ArtifactItem;
  onSubmit: (item: ArtifactItem, review: PptFullDeckReviewSubmission) => Promise<void>;
}) {
  const deck = item.pptFullDeckReview!;
  const [reviews, setReviews] = useState<Record<string, PageReview>>(() => buildReviews(deck));
  const [submitting, setSubmitting] = useState(false);
  const readOnly = item.status === "approved" || deck.reviewStatus === "passed";
  const canSubmit = useMemo(() => Boolean(!readOnly && deck.pageIds.length && deck.pageIds.every((pageId) => validReview(reviews[pageId]))), [deck, readOnly, reviews]);
  const currentDeck = deck;

  const evidenceBase = `/api/workbench/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/ppt-full-deck-evidence`;
  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(item, {
        candidateDigest: currentDeck.candidateDigest,
        reviewSource: "teacher",
        qa: currentDeck.pageIds.map((pageId) => ({
          pageId,
          design: reviews[pageId].design ? "passed" : "failed",
          visual: reviews[pageId].visual ? "passed" : "failed",
          provenance: reviews[pageId].provenance ? "passed" : "failed",
          readability: reviews[pageId].readability ? "passed" : "failed",
          findings: reviews[pageId].findings.trim() ? [reviews[pageId].findings.trim()] : [],
        })),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mb-5 border-b border-[#e3ece9] pb-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{readOnly ? "完整课件审查结果" : "完整课件逐页审查"}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{readOnly ? "当前版本已完成审查；修改后会进入新的课件版本。" : "逐页核对设计、画面、来源和可读性；未通过时写明页面对象或位置。"}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="secondary" size="sm" asChild><a href={`${evidenceBase}?kind=pptx`} download><Download className="h-4 w-4" />PPTX</a></Button>
          <Button variant="secondary" size="sm" asChild><a href={`${evidenceBase}?kind=pdf`} download><Download className="h-4 w-4" />PDF</a></Button>
        </div>
      </div>
      <figure className="mb-4 overflow-hidden rounded-md border border-[#dfe8e5] bg-white">
        <div className="relative aspect-[16/9] w-full"><Image fill unoptimized sizes="460px" className="object-contain" src={`${evidenceBase}?kind=contact-sheet`} alt="完整课件总览" /></div>
        <figcaption className="border-t border-[#edf2f0] px-2 py-1.5 text-xs text-muted-foreground">完整课件总览</figcaption>
      </figure>
      <div className="space-y-3">
        {currentDeck.pageIds.map((pageId, index) => {
          const review = reviews[pageId] ?? emptyReview();
          return (
            <div key={pageId} className="grid gap-3 rounded-md border border-[#dfe8e5] bg-white p-3 sm:grid-cols-[160px_1fr]">
              <div className="relative aspect-video w-full overflow-hidden rounded border border-[#edf2f0]">
                <Image fill unoptimized sizes="160px" className="object-contain" src={`${evidenceBase}?kind=page&id=${encodeURIComponent(pageId)}`} alt={`课件第 ${index + 1} 页`} />
              </div>
              <div className="min-w-0">
                <div className="mb-2 text-sm font-medium">第 {index + 1} 页</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["design", "visual", "provenance", "readability"] as const).map((field) => (
                    <label key={field} className="flex min-h-8 items-center gap-2 text-xs">
                      <input type="checkbox" className="h-4 w-4 accent-[#32685d]" disabled={readOnly} checked={review[field]} onChange={(event) => update(setReviews, pageId, field, event.target.checked)} />
                      {label(field)}
                    </label>
                  ))}
                </div>
                <textarea value={review.findings} disabled={readOnly} onChange={(event) => update(setReviews, pageId, "findings", event.target.value)} placeholder={allChecksPass(review) ? "" : "写明需要调整的对象或位置"} className="mt-2 min-h-16 w-full resize-y rounded-md border border-[#d8e2df] bg-[#fcfdfd] px-3 py-2 text-xs leading-5 outline-none focus:border-[#32685d]" />
              </div>
            </div>
          );
        })}
      </div>
      {!readOnly && <div className="mt-3 flex justify-end"><Button disabled={!canSubmit || submitting} onClick={() => void submit()}><Send className="h-4 w-4" />{submitting ? "正在提交" : "提交逐页审查"}</Button></div>}
    </section>
  );
}

function emptyReview(): PageReview { return { design: false, visual: false, provenance: false, readability: false, findings: "" }; }
function buildReviews(deck: NonNullable<ArtifactItem["pptFullDeckReview"]>): Record<string, PageReview> {
  return Object.fromEntries(deck.pageIds.map((pageId) => {
    const previous = deck.qa?.find((entry) => entry.pageId === pageId);
    return [pageId, previous ? {
      design: previous.design === "passed",
      visual: previous.visual === "passed",
      provenance: previous.provenance === "passed",
      readability: previous.readability === "passed",
      findings: previous.findings.join("；"),
    } : emptyReview()];
  }));
}
function allChecksPass(review: PageReview) { return review.design && review.visual && review.provenance && review.readability; }
function validReview(review: PageReview | undefined) { return Boolean(review && (allChecksPass(review) ? !review.findings.trim() : Boolean(review.findings.trim()))); }
function update(setReviews: Dispatch<SetStateAction<Record<string, PageReview>>>, pageId: string, field: keyof PageReview, value: boolean | string) { setReviews((current) => ({ ...current, [pageId]: { ...(current[pageId] ?? emptyReview()), [field]: value } })); }
function label(field: keyof Omit<PageReview, "findings">) { return field === "design" ? "设计符合" : field === "visual" ? "画面合格" : field === "provenance" ? "来源可信" : "文字清晰"; }
