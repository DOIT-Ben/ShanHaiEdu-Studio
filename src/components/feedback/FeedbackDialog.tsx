"use client";

import { useState, type ChangeEvent, type ClipboardEvent } from "react";
import Image from "next/image";
import { Check, CheckCircle2, ImagePlus, Loader2, Maximize2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FeedbackController } from "@/hooks/useFeedbackController";
import { feedbackCategoryOptions, feedbackSeverityOptions } from "@/lib/feedback-contracts";
import { cn } from "@/lib/utils";
export function FeedbackDialog({ controller }: { controller: FeedbackController }) {
  const submitting = controller.status === "submitting";
  const canSubmit = Boolean(controller.category && controller.title.trim() && controller.description.trim());
  const [previewImage, setPreviewImage] = useState<(typeof controller.images)[number] | null>(null);
  const selectedCategory = feedbackCategoryOptions.find((option) => option.id === controller.category);
  const selectedChoiceClass = "border-2 border-[#367d6d] bg-[#eef7f3] font-medium text-[#123f33] shadow-[0_0_0_2px_rgba(54,125,109,0.12)]";
  const idleChoiceClass = "border border-input bg-background text-muted-foreground hover:border-[#8fcbbb] hover:bg-[#f7fbf9] hover:text-foreground";

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    if (submitting) return;
    controller.addImages(Array.from(event.currentTarget.files ?? []), "selected", event.currentTarget.dataset.feedbackImageKind === "expected" ? "expected" : "issue");
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
    const pasteTarget = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-feedback-paste-kind]")?.dataset.feedbackPasteKind
      : undefined;
    controller.addImages(pastedImages, "pasted", pasteTarget === "expected" ? "expected" : "issue");
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
        className="flex h-[min(760px,calc(100dvh-24px))] w-[calc(100%-24px)] max-w-[640px] flex-col overflow-hidden"
        onPaste={handlePaste}
      >
        <header className="border-b px-5 py-4 pr-12 sm:px-6">
          <DialogTitle className="text-base font-semibold text-foreground">提交反馈</DialogTitle>
        </header>

        {controller.status === "submitted" ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
            <CheckCircle2 className="h-9 w-9 text-[#367d6d]" />
            <p className="mt-4 text-base font-medium text-foreground">反馈成功</p>
            {controller.receipt?.receiptCode && (
              <p className="mt-2 text-sm text-muted-foreground">回执编号：{controller.receipt.receiptCode}</p>
            )}
            <Button className="mt-6" variant="secondary" onClick={controller.closeFeedback}>完成</Button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
               <fieldset aria-required="true">
                 <legend className="text-sm font-semibold text-foreground">反馈类型</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {feedbackCategoryOptions.map((option) => {
                    const selected = controller.category === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        data-feedback-category={option.id}
                        disabled={submitting}
                        aria-pressed={controller.category === option.id}
                        onClick={() => controller.setCategory(option.id)}
                        className={cn(
                          "min-h-10 rounded-md px-3 py-2 text-left text-sm leading-5 transition focus:outline-none focus:ring-2 focus:ring-[#367d6d]",
                          selected ? selectedChoiceClass : idleChoiceClass,
                        )}
                      >
                        <span className="flex min-w-0 items-center justify-between gap-2">
                          <span>{option.label}</span>
                          {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

                <div data-feedback-quick-supplement className="min-h-28 shrink-0">
                  <p className="text-sm font-medium text-foreground">快速补充</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(selectedCategory?.chips ?? []).map((chip) => {
                      const selected = controller.description.includes(chip);
                      return (
                        <button
                          key={chip}
                          type="button"
                          data-feedback-chip
                          disabled={submitting}
                          aria-pressed={controller.description.includes(chip)}
                          onClick={() => controller.appendDescriptionChip(chip)}
                          className={cn(
                            "rounded-md px-2.5 py-1.5 text-xs transition focus:outline-none focus:ring-2 focus:ring-[#367d6d]",
                            selected ? selectedChoiceClass : idleChoiceClass,
                          )}
                        >
                          <span className="flex items-center gap-1.5">
                            <span>{chip}</span>
                            {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <fieldset>
                  <legend className="text-sm font-semibold text-foreground">影响程度</legend>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {feedbackSeverityOptions.map((option) => {
                      const selected = controller.severity === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          data-feedback-severity={option.id}
                          disabled={submitting}
                          aria-pressed={selected}
                          onClick={() => controller.setSeverity(option.id)}
                          className={cn(
                            "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-[#367d6d]",
                            selected ? selectedChoiceClass : idleChoiceClass,
                          )}
                        >
                          {selected && <Check className="h-3.5 w-3.5" />}
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

               <label className="block" data-feedback-paste-kind="issue">
                  <span className="text-sm font-semibold text-foreground">反馈标题</span>
                 <Input
                   data-feedback-title
                   disabled={submitting}
                   required
                   value={controller.title}
                   onChange={(event) => controller.setTitle(event.target.value)}
                   placeholder="用一句话说明你遇到的问题"
                   className="mt-2"
                 />
               </label>

               <label className="block">
                  <span className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-foreground">
                   <span>反馈内容</span>
                   <span className="text-xs font-normal text-muted-foreground">建议上传问题截图</span>
                 </span>
                 <Textarea
                   data-feedback-description
                  disabled={submitting}
                  required
                  aria-required="true"
                  value={controller.description}
                  onChange={(event) => controller.setDescription(event.target.value)}
                   placeholder={selectedCategory?.placeholder ?? "描述你遇到的情况、触发步骤或不舒服的地方。"}
                  rows={4}
                   className="mt-2 resize-y"
                />
               </label>

               <div data-feedback-paste-kind="issue">
                <FeedbackImageSection
                  title="问题截图"
                 hint="建议上传问题截图，也可以直接粘贴。"
                 kind="issue"
                 images={controller.images.filter((image) => image.kind === "issue")}
                 disabled={submitting}
                 onChange={handleFileSelection}
                 onPreview={setPreviewImage}
                 onRemove={controller.removeImage}
                />
               </div>

               <label className="block" data-feedback-paste-kind="expected">
                  <span className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-foreground">
                   <span>期望效果</span>
                   <span className="text-xs font-normal text-muted-foreground">可上传参考图</span>
                 </span>
                 <Textarea
                   data-feedback-expected-effect
                   disabled={submitting}
                   value={controller.expectedEffect}
                   onChange={(event) => controller.setExpectedEffect(event.target.value)}
                   placeholder="描述你希望看到的效果，或说明参考图中值得借鉴的部分。"
                   rows={3}
                   className="mt-2 resize-y"
                 />
               </label>

               <div data-feedback-paste-kind="expected">
                <FeedbackImageSection
                  title="期望参考图"
                  hint="可上传你认为更合适的界面或交互参考，也可以在这里直接粘贴。"
                 kind="expected"
                 images={controller.images.filter((image) => image.kind === "expected")}
                 disabled={submitting}
                 onChange={handleFileSelection}
                 onPreview={setPreviewImage}
                 onRemove={controller.removeImage}
                />
               </div>

              {(controller.validationError || controller.errorMessage) && (
                <p role="alert" className="rounded-md bg-[#fff6f4] px-3 py-2 text-sm leading-6 text-[#8f3c30]">
                  {controller.validationError ?? controller.errorMessage}
                </p>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t px-5 py-4 sm:px-6">
              <Button variant="ghost" onClick={controller.closeFeedback} disabled={controller.status === "submitting"}>取消</Button>
              <Button
                onClick={() => void controller.submit()}
                disabled={submitting || !canSubmit}
                data-feedback-submit
                className={cn(
                  canSubmit && !submitting && "border-[#367d6d] bg-[#367d6d] text-white hover:bg-[#286657] active:bg-[#1e5145]",
                )}
              >
                {controller.status === "submitting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {controller.status === "failed" ? "重新提交" : controller.status === "submitting" ? "正在提交" : "提交反馈"}
              </Button>
            </footer>
          </>
         )}
        <Dialog open={Boolean(previewImage)} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
          <DialogContent className="w-[calc(100%-32px)] max-w-4xl p-3">
            <DialogTitle className="sr-only">图片预览</DialogTitle>
            {previewImage && <Image unoptimized src={previewImage.previewUrl} alt={previewImage.file.name || "反馈图片预览"} width={1600} height={900} className="max-h-[78vh] w-full rounded-md object-contain" />}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function FeedbackImageSection({
  title,
  hint,
  kind,
  images,
  disabled,
  onChange,
  onPreview,
  onRemove,
}: {
  title: string;
  hint: string;
  kind: "issue" | "expected";
  images: FeedbackController["images"];
  disabled: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPreview: (image: FeedbackController["images"][number]) => void;
  onRemove: (imageId: string) => void;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
           <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <label aria-disabled={disabled} className={cn("inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground transition focus-within:ring-2 focus-within:ring-[#367d6d]", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted")}>
          <ImagePlus className="h-4 w-4" />
          添加图片
          <input data-feedback-image-kind={kind} type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={disabled} className="sr-only" onChange={onChange} />
        </label>
      </div>
      {images.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((image) => (
            <div key={image.id} data-feedback-image className="group relative overflow-hidden rounded-md border bg-muted/30">
              <button type="button" onClick={() => onPreview(image)} className="relative block w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#367d6d]" aria-label={`放大查看图片 ${image.file.name || "截图"}`}>
                <Image unoptimized src={image.previewUrl} alt={image.file.name || "待提交图片"} width={640} height={360} className="aspect-video w-full object-cover transition duration-200 group-hover:scale-[1.02]" />
                <span className="absolute inset-0 flex items-center justify-center bg-foreground/0 text-white opacity-0 transition group-hover:bg-foreground/25 group-hover:opacity-100"><Maximize2 className="h-5 w-5" /></span>
              </button>
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                <span data-feedback-image-source className="truncate">{image.source === "pasted" ? "已粘贴" : "已选择"} · {formatFileSize(image.file.size)}</span>
                <button type="button" onClick={() => onRemove(image.id)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-[#367d6d]" aria-label={`删除图片 ${image.file.name || "截图"}`} disabled={disabled}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
