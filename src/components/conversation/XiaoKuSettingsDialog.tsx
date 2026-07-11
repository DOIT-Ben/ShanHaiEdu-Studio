"use client";

import { Check, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { xiaokuResponseStyleOptions, type XiaoKuResponseStyle } from "@/lib/xiaoku-preferences";
import { cn } from "@/lib/utils";

type XiaoKuSettingsDialogProps = {
  open: boolean;
  value: XiaoKuResponseStyle;
  onOpenChange: (open: boolean) => void;
  onChange: (value: XiaoKuResponseStyle) => void;
};

export function XiaoKuSettingsDialog({ open, value, onOpenChange, onChange }: XiaoKuSettingsDialogProps) {
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
