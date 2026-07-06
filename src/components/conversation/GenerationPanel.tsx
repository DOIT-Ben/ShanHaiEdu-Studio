"use client";

import { BookOpen, CheckCircle2, Eye, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type GenerationPanelProps = {
  onConfirmIntro: () => void;
  onRecover: () => void;
};

function SlideThumb({ index, active }: { index: number; active?: boolean }) {
  return (
    <div className={active ? "rounded-lg border border-input bg-white p-2" : "rounded-lg border bg-white p-2"}>
      <div className="h-20 rounded-md bg-muted" />
      <div className="mt-2 text-center text-xs text-muted-foreground">{index} / 12</div>
    </div>
  );
}

export function GenerationPanel({ onConfirmIntro, onRecover }: GenerationPanelProps) {
  return (
    <section className="space-y-6">
      <div className="rounded-lg border bg-card px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="font-medium">任务：生成教学设计方案</div>
              <div className="mt-1 text-sm text-muted-foreground">已完成 10:24</div>
            </div>
          </div>
          <Button variant="ghost" size="sm">查看详情</Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            <div className="font-medium">参考依据</div>
            <span className="text-sm text-muted-foreground">已检索 3 条</span>
          </div>
          <Button variant="ghost" size="sm">查看详情</Button>
        </div>
        <ul className="mt-3 space-y-1 pl-8 text-sm leading-6 text-foreground">
          <li>义务教育数学课程标准（2022年版）</li>
          <li>小学数学二年级上册教材（人教版）</li>
          <li>表内乘法教学建议与典型课例</li>
        </ul>
      </div>

      <div className="relative rounded-lg border bg-muted/35 px-5 py-4">
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <div className="font-medium">当前行动</div>
              <span className="text-sm text-muted-foreground">10:24</span>
            </div>
            <p className="mt-2 text-sm leading-6">正在拆分 PPT 页面，预计 1 分钟。已确认教案与导入锚点。</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-border">
              <div className="h-full w-[48%] rounded-full bg-muted-foreground/45" />
            </div>
          </div>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <h2 className="font-medium">PPT 页面生成中</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">12 页，已生成 8 页，来自已确认教案与导入锚点。</p>
          </div>
          <Badge tone="neutral">进行中</Badge>
        </div>
        <div className="mt-5 grid grid-cols-[180px_1fr] gap-5 max-lg:grid-cols-1">
          <div className="space-y-3 rounded-lg bg-muted/45 p-4 text-sm">
            {["封面", "学习目标", "情境导入", "练习巩固"].map((name, index) => (
              <div key={name} className="flex items-center justify-between">
                <span>{name}</span>
                <span className="text-muted-foreground">{index < 2 ? "已完成" : "待生成"}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <SlideThumb index={1} active />
            <SlideThumb index={2} />
            <SlideThumb index={3} />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="default" onClick={onConfirmIntro}>
            <CheckCircle2 className="h-4 w-4" />
            确认使用
          </Button>
          <Button variant="secondary">
            调整后重做
          </Button>
          <Button variant="secondary">
            <Eye className="h-4 w-4" />
            查看详情
          </Button>
          <Button variant="ghost" onClick={onRecover}>失败恢复示例</Button>
        </div>
      </div>
    </section>
  );
}
