"use client";

import { useRef, type KeyboardEvent } from "react";
import { ArrowUp, Bot, ChevronDown, FilePlus2, ListChecks, LoaderCircle, Paperclip, Plus, Sparkles, Target, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MenuItem } from "@/components/ui/menu-item";
import { AttachmentStatusCard } from "@/components/conversation/composer/AttachmentStatusCard";
import { useAutoResizeTextarea } from "@/components/conversation/composer/useAutoResizeTextarea";
import { useComposerAttachments } from "@/components/conversation/composer/useComposerAttachments";

type PromptComposerProps = {
  value: string;
  reference: string | null;
  notice: string | null;
  composerSubmitting: boolean;
  projectBusy: boolean;
  onChange: (value: string) => void;
  onClearReference: () => void;
  onAttachFile: (fileName: string, text: string) => void;
  onAttachFileError: (message: string) => void;
  onSend: () => void;
  generationIntensityLabel: string;
  onOpenSettings?: () => void;
};

export function PromptComposer({ value, reference, notice, composerSubmitting, projectBusy, onChange, onClearReference, onAttachFile, onAttachFileError, onSend, generationIntensityLabel, onOpenSettings }: PromptComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachments = useComposerAttachments({ value, reference, composerSubmitting, onClearReference, onAttachFile, onAttachFileError });
  useAutoResizeTextarea(textareaRef, value, { minRows: 2, maxRows: 8 });
  const { visibleAttachment, fileInputRef, draggingFile, handleFileChange, handleDragEnter, handleDragOver, handleDragLeave, handleDrop, handlePaste, clearAttachment, setAttachmentSubmission } = attachments;
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!composerSubmitting) handleSubmit();
  }
  function handleSubmit() {
    if (visibleAttachment?.status === "pending_parse") {
      onAttachFileError("这份资料还在读取，请稍候再发送。");
      return;
    }
    if (visibleAttachment && (value.trim() || reference)) setAttachmentSubmission({ value, reference });
    onSend();
  }
  return (
    <div className="bg-card px-4 pb-4 pt-3 sm:px-8">
      <div className="mx-auto w-full max-w-[980px]">
        {visibleAttachment && <AttachmentStatusCard attachment={visibleAttachment} onRemove={composerSubmitting ? undefined : clearAttachment} />}
        {reference && !visibleAttachment?.canUseAsReference && (
          <div className="mb-2 inline-flex max-w-full items-start justify-between gap-3 rounded-lg bg-muted px-3 py-2">
            <div className="min-w-0 text-xs leading-5 text-foreground"><span className="font-medium text-muted-foreground">引用：</span><span>{reference}</span></div>
            <button type="button" onClick={onClearReference} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="移除引用"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <div data-composer-surface className="relative rounded-[22px] border border-[#dfe1e3] bg-card px-3 py-2 shadow-[0_14px_38px_rgba(0,0,0,0.06)] transition duration-150 ease-out hover:border-[#c9cccf] hover:shadow-[0_18px_46px_rgba(0,0,0,0.075)] focus-within:border-[#9ca3a8] focus-within:shadow-[0_18px_50px_rgba(0,0,0,0.085)]" onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          {draggingFile && <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border border-dashed border-foreground/30 bg-card/92 text-sm font-medium text-foreground">松开后添加到本轮备课要求</div>}
          <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown,.csv,.json,.text,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,text/*,application/pdf,image/*" className="hidden" onChange={handleFileChange} aria-label="选择资料" disabled={composerSubmitting} />
          <Textarea ref={textareaRef} id="lesson-workbench-prompt" name="lesson-workbench-prompt" value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} disabled={composerSubmitting} aria-label={projectBusy ? "正在生成中，也可以继续输入下一步要求" : "输入备课要求"} placeholder="输入备课要求，或和小酷聊聊这节课" className="min-h-[96px] border-0 bg-transparent px-2 py-2 text-sm leading-6 shadow-none placeholder:text-muted-foreground/75 focus:ring-0" />
          <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-1">
            <div className="flex min-w-0 items-center gap-2">
              <Popover>
                <PopoverTrigger asChild><button type="button" aria-label="添加选项" title="添加资料或工具" disabled={composerSubmitting} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-[#f0f1f2] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#367d6d]/45 disabled:pointer-events-none disabled:opacity-45"><Plus className="h-5 w-5" /></button></PopoverTrigger>
                <PopoverContent align="start" className="w-[min(336px,calc(100vw-32px))] rounded-xl p-2">
                  <div className="px-2.5 pb-2 pt-1 text-xs font-medium text-muted-foreground">添加</div>
                  <div className="space-y-0.5"><MenuItem icon={<Paperclip className="h-4 w-4" />} onClick={() => fileInputRef.current?.click()}>添加资料</MenuItem><ComposerMenuPlaceholder icon={<Target className="h-4 w-4" />} label="课堂目标" /><ComposerMenuPlaceholder icon={<ListChecks className="h-4 w-4" />} label="计划模式" /></div>
                  <div className="my-2 border-t" />
                  <div className="px-2.5 pb-2 text-xs font-medium text-muted-foreground">工具</div>
                  <div className="space-y-0.5"><ComposerMenuPlaceholder icon={<FilePlus2 className="h-4 w-4" />} label="课堂资料整理" /><ComposerMenuPlaceholder icon={<Bot className="h-4 w-4" />} label="教学设计审阅" /></div>
                </PopoverContent>
              </Popover>
              <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block" aria-live="polite">{notice ?? (projectBusy ? "正在生成中，你可以继续输入下一条要求。" : null)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild><button type="button" aria-label="选择生成强度" className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs text-foreground transition hover:bg-[#f0f1f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#367d6d]/45"><Sparkles className="h-3.5 w-3.5 text-[#367d6d]" /><span>生成强度 · {generationIntensityLabel}</span><ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /></button></PopoverTrigger>
                <PopoverContent align="end" className="w-60 rounded-xl p-2"><div className="px-2.5 pb-2 pt-1 text-xs font-medium text-muted-foreground">生成强度</div><MenuItem onClick={onOpenSettings} icon={<Sparkles className="h-4 w-4 text-[#367d6d]" />}><span className="flex-1">{generationIntensityLabel}</span><span className="text-xs text-muted-foreground">当前</span></MenuItem><div className="mt-1 px-2.5 py-2 text-xs leading-5 text-muted-foreground">强度越大，积分消耗越快。</div></PopoverContent>
              </Popover>
              <button type="button" aria-label={composerSubmitting ? "正在发送" : projectBusy ? "加入队列" : "发送"} title={composerSubmitting ? "正在发送" : projectBusy ? "加入队列" : "发送"} onClick={handleSubmit} disabled={composerSubmitting} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#191c20] text-white transition hover:bg-[#30343a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#367d6d]/45 disabled:cursor-not-allowed disabled:opacity-55">{composerSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComposerMenuPlaceholder({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <MenuItem disabled icon={icon} className="text-muted-foreground disabled:opacity-60"><span>{label}</span><span className="ml-auto text-xs">即将提供</span></MenuItem>;
}
