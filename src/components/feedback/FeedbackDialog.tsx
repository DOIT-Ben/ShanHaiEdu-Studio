"use client";

import type { ChangeEvent, ClipboardEvent } from "react";
import { CheckCircle2, ImagePlus, Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { FeedbackController } from "@/hooks/useFeedbackController";
import { feedbackCategoryOptions, feedbackSeverityOptions } from "@/lib/feedback-contracts";
import { cn } from "@/lib/utils";

export function FeedbackDialog({ controller }: { controller: FeedbackController }) {
  const submitting = controller.status === "submitting";
  const selectedCategory = feedbackCategoryOptions.find((option) => option.id === controller.category);

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    if (submitting) return;
    controller.addImages(Array.from(event.currentTarget.files ?? []), "selected");
    event.currentTarget.value = "";
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (submitting) return;
    const pastedImages = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (pastedImages.length === 0) return;
    event.preventDefault();
    controller.addImages(pastedImages, "pasted");
  }

  return (
    <Dialog
      open={controller.open}
      onOpenChange={(open) => {
        if (!open && controller.status !== "submitting") controller.closeFeedback();
      }}
    >
      <DialogContent
        data-feedback-dialog
        data-feedback-status={controller.status}
        className="flex w-[calc(100%-24px)] max-w-[640px] flex-col"
        onPaste={handlePaste}
      >
        <header className="border-b px-5 py-4 pr-12 sm:px-6">
          <DialogTitle className="text-base font-medium text-foreground">提交反馈</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-6 text-muted-foreground">
            告诉我们哪里影响了备课，可同时选择或粘贴截图。
          </DialogDescription>
        </header>

        {controller.status === "submitted" ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
            <CheckCircle2 className="h-9 w-9 text-[#367d6d]" />
            <p className="mt-4 text-base font-medium text-foreground">反馈已收到</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              编号 {controller.receipt?.receiptCode}。谢谢你帮助我们改进。
            </p>
            <Button className="mt-6" variant="secondary" onClick={controller.closeFeedback}>完成</Button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
              <fieldset>
                <legend className="text-sm font-medium text-foreground">反馈类型</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {feedbackCategoryOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      data-feedback-category={option.id}
                      disabled={submitting}
                      aria-pressed={controller.category === option.id}
                      onClick={() => controller.setCategory(option.id)}
                      className={cn(
                        "min-h-10 rounded-md border px-3 py-2 text-left text-sm leading-5 transition focus:outline-none focus:ring-2 focus:ring-[#8fcbbb]/45",
                        controller.category === option.id
                          ? "border-[#8fcbbb] bg-[#f2f8f6] text-foreground"
                          : "border-input bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {selectedCategory && (
                <div>
                  <p className="text-sm font-medium text-foreground">快速补充</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedCategory.chips.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        data-feedback-chip
                        disabled={submitting}
                        onClick={() => controller.appendDescriptionChip(chip)}
                        className="rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-[#8fcbbb]/45"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="block">
                <span className="text-sm font-medium text-foreground">具体情况</span>
                <textarea
                  data-feedback-description
                  disabled={submitting}
                  value={controller.description}
                  onChange={(event) => controller.setDescription(event.target.value)}
                  placeholder={selectedCategory?.placeholder ?? "先选择反馈类型，再写下你遇到的情况。"}
                  rows={4}
                  className="mt-2 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-[#8fcbbb]/45"
                />
              </label>

              <fieldset>
                <legend className="text-sm font-medium text-foreground">影响程度（选填）</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {feedbackSeverityOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      data-feedback-severity={option.id}
                      disabled={submitting}
                      aria-pressed={controller.severity === option.id}
                      onClick={() => controller.setSeverity(controller.severity === option.id ? "" : option.id)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-[#8fcbbb]/45",
                        controller.severity === option.id
                          ? "border-[#8fcbbb] bg-[#f2f8f6] text-foreground"
                          : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">图片（选填）</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">最多 5 张，可在弹窗中直接粘贴截图。</p>
                  </div>
                  <label
                    aria-disabled={submitting}
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground transition focus-within:ring-2 focus-within:ring-[#8fcbbb]/45",
                      submitting ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted",
                    )}
                  >
                    <ImagePlus className="h-4 w-4" />
                    选择图片
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      disabled={submitting}
                      className="sr-only"
                      onChange={handleFileSelection}
                    />
                  </label>
                </div>
                {controller.images.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {controller.images.map((image) => (
                      <div key={image.id} data-feedback-image className="relative overflow-hidden rounded-md border bg-muted/30">
                        <img src={image.previewUrl} alt={image.file.name || "待提交图片"} className="aspect-video w-full object-cover" />
                        <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                          <span data-feedback-image-source className="truncate">
                            {image.source === "pasted" ? "已粘贴" : "已选择"} · {formatFileSize(image.file.size)}
                          </span>
                          <button
                            type="button"
                            onClick={() => controller.removeImage(image.id)}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-[#8fcbbb]/45"
                            aria-label={`删除图片 ${image.file.name || "截图"}`}
                            disabled={submitting}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(controller.validationError || controller.errorMessage) && (
                <p role="alert" className="rounded-md bg-[#fff6f4] px-3 py-2 text-sm leading-6 text-[#8f3c30]">
                  {controller.validationError ?? controller.errorMessage}
                </p>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t px-5 py-4 sm:px-6">
              <Button variant="ghost" onClick={controller.closeFeedback} disabled={controller.status === "submitting"}>取消</Button>
              <Button onClick={() => void controller.submit()} disabled={controller.status === "submitting"} data-feedback-submit>
                {controller.status === "submitting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {controller.status === "failed" ? "重新提交" : controller.status === "submitting" ? "正在提交" : "提交反馈"}
              </Button>
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
