"use client";

import { CheckCircle2, Eye, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type GenerationPanelProps = {
  onConfirmIntro: () => void;
  onRecover: () => void;
};

export function GenerationPanel({ onConfirmIntro, onRecover }: GenerationPanelProps) {
  return (
    <section className="max-w-[860px] border-t pt-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex min-w-0 items-center gap-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate font-medium">已确认上游依据</div>
            <p className="mt-1 truncate text-muted-foreground">教学设计方案、课程标准、教材页段和导入锚点</p>
          </div>
        </div>
        <Button variant="ghost" size="sm">查看</Button>
      </div>

      <div className="rounded-xl border bg-card px-5 py-4 transition duration-150 ease-out hover:shadow-[0_10px_30px_rgba(0,0,0,0.045)]">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-medium">PPT 页面生成中</h2>
              <Badge tone="neutral">8 / 12</Badge>
              <span className="text-muted-foreground">10:24</span>
            </div>
            <p className="mt-3 text-sm leading-6">正在拆分 PPT 页面，预计 1 分钟。已确认教案与导入锚点。</p>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-border">
              <div className="h-full w-[48%] rounded-full bg-muted-foreground/45" />
            </div>
          </div>
          <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-muted-foreground" />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">12 页，已生成 8 页，来自已确认教案与导入锚点。</p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="secondary" onClick={onConfirmIntro}>
              <CheckCircle2 className="h-4 w-4" />
              确认
            </Button>
            <Button variant="ghost">
              <Eye className="h-4 w-4" />
              详情
            </Button>
            <Button variant="ghost" onClick={onRecover}>恢复</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
