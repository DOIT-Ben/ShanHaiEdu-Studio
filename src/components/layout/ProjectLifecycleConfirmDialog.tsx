"use client";

import { Archive, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ProjectItem } from "@/lib/types";

type ProjectLifecycleConfirmDialogProps = {
  project: ProjectItem | null;
  action: "archive" | "trash" | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function ProjectLifecycleConfirmDialog({ project, action, submitting, onOpenChange, onConfirm }: ProjectLifecycleConfirmDialogProps) {
  const isTrash = action === "trash";
  const open = Boolean(project && action);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-32px)] max-w-md p-0">
        <div className="border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base font-medium text-foreground">
            {isTrash ? <Trash2 className="h-4 w-4 text-destructive" /> : <Archive className="h-4 w-4 text-[#367d6d]" />}
            {isTrash ? "移入回收站" : "归档项目"}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">
            {isTrash
              ? `“${project?.title ?? "该项目"}”会进入回收站，可以恢复。`
              : `“${project?.title ?? "该项目"}”会移到已归档列表，不会删除已有内容。`}
          </DialogDescription>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
          <Button variant={isTrash ? "danger" : "default"} onClick={onConfirm} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isTrash ? "移入回收站" : "确认归档"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
