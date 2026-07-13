"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { generationIntensityOptions } from "@/lib/generation-intensity";
import type { GenerationIntensity, ProjectItem } from "@/lib/types";
import { xiaokuResponseStyleOptions, type XiaoKuResponseStyle } from "@/lib/xiaoku-preferences";
import { cn } from "@/lib/utils";

type XiaoKuSettingsDialogProps = {
  open: boolean;
  value: XiaoKuResponseStyle;
  onOpenChange: (open: boolean) => void;
  onChange: (value: XiaoKuResponseStyle) => void;
  generationIntensity: GenerationIntensity;
  generationIntensitySuggestion: ProjectItem["generationIntensitySuggestion"];
  onGenerationIntensityChange: (value: GenerationIntensity, confirmationActionId?: string) => Promise<{
    project: ProjectItem;
    confirmationRequired?: boolean;
    actionId?: string;
  }>;
};

export function XiaoKuSettingsDialog({ open, value, generationIntensity, generationIntensitySuggestion, onOpenChange, onChange, onGenerationIntensityChange }: XiaoKuSettingsDialogProps) {
  const [draftIndex, setDraftIndex] = useState(() => intensityIndex(generationIntensity));
  const [pendingExtremeActionId, setPendingExtremeActionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => setDraftIndex(intensityIndex(generationIntensity)), [generationIntensity]);

  async function commitIntensity(index = draftIndex) {
    const target = generationIntensityOptions[index]?.id ?? "standard";
    if (target === generationIntensity) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await onGenerationIntensityChange(target);
      setPendingExtremeActionId(result.confirmationRequired ? result.actionId ?? null : null);
    } catch {
      setDraftIndex(intensityIndex(generationIntensity));
      setSaveError("生成强度已变化，请重新选择。 ");
    } finally {
      setSaving(false);
    }
  }

  async function confirmExtreme() {
    if (!pendingExtremeActionId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onGenerationIntensityChange("extreme", pendingExtremeActionId);
      setPendingExtremeActionId(null);
    } catch {
      setDraftIndex(intensityIndex(generationIntensity));
      setPendingExtremeActionId(null);
      setSaveError("生成强度已变化，请重新选择。 ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-32px)] max-w-md p-0">
        <div className="border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base font-medium"><SlidersHorizontal className="h-4 w-4 text-[#367d6d]" />小酷偏好</DialogTitle>
        </div>
        <div className="space-y-2 px-5 py-4">
          <p className="text-sm font-medium text-foreground">回复方式</p>
          {xiaokuResponseStyleOptions.map((option) => {
            const selected = value === option.id;
            return <button key={option.id} type="button" aria-pressed={selected} onClick={() => onChange(option.id)} className={cn("flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#367d6d]/45", selected ? "border-[#367d6d] bg-[#eef7f3] text-foreground" : "border-input hover:bg-muted/60")}>
              <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-[#367d6d] bg-[#367d6d] text-white" : "border-muted-foreground/45")}>{selected && <Check className="h-3 w-3" />}</span>
              <span className="min-w-0"><span className="block text-sm font-medium">{option.label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span></span>
            </button>;
          })}
          <div className="pt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">生成强度</p>
              <span className="text-xs text-muted-foreground">{generationIntensityOptions[draftIndex]?.costLabel}</span>
            </div>
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={draftIndex}
              disabled={saving}
              aria-label="生成强度"
              aria-valuetext={generationIntensityOptions[draftIndex]?.label}
              onChange={(event) => setDraftIndex(Number(event.target.value))}
              onPointerUp={(event) => void commitIntensity(Number(event.currentTarget.value))}
              onKeyUp={() => void commitIntensity()}
              className="mt-4 w-full accent-[#367d6d]"
            />
            <div className="mt-2 grid grid-cols-4 text-center text-xs text-muted-foreground">
              {generationIntensityOptions.map((option) => <span key={option.id}>{option.label}</span>)}
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">强度越大，处理复杂任务时会投入更多推理，积分消耗也会更快。</p>
            {saveError && <p role="alert" className="mt-2 text-xs text-destructive">{saveError}</p>}
            {generationIntensitySuggestion && generationIntensitySuggestion.target !== generationIntensity && (
              <div className="mt-3 rounded-md border bg-muted/40 p-3">
                <p className="text-xs leading-5 text-foreground">当前任务连续未解决，建议尝试{generationIntensityOptions.find((option) => option.id === generationIntensitySuggestion.target)?.label ?? "更高"}强度。</p>
                <button type="button" disabled={saving} className="mt-2 text-xs font-medium text-[#367d6d] disabled:opacity-50" onClick={() => { setDraftIndex(intensityIndex(generationIntensitySuggestion.target)); void commitIntensity(intensityIndex(generationIntensitySuggestion.target)); }}>采用建议</button>
              </div>
            )}
          </div>
          {pendingExtremeActionId && (
            <div role="alertdialog" aria-label="确认使用极致强度" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
              <div className="flex gap-2 text-sm font-medium text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />确认使用极致强度</div>
              <p className="mt-2 text-xs leading-5 text-amber-900">极致强度会更快消耗积分，仅建议用于其他档位持续无法解决的复杂任务。</p>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" className="h-8 px-3 text-xs text-muted-foreground" onClick={() => { setPendingExtremeActionId(null); setDraftIndex(intensityIndex(generationIntensity)); }}>取消</button>
                <button type="button" disabled={saving} className="h-8 rounded-md bg-[#191c20] px-3 text-xs text-white disabled:opacity-50" onClick={() => void confirmExtreme()}>确认使用</button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function intensityIndex(value: GenerationIntensity) {
  return Math.max(0, generationIntensityOptions.findIndex((option) => option.id === value));
}
