"use client";

import { CheckCircle2, MoreHorizontal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WorkbenchTopbar() {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-6 lg:px-8">
      <nav className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden whitespace-nowrap text-sm text-muted-foreground" aria-label="当前位置">
        <span className="shrink-0">ShanHaiEdu</span>
        <span className="shrink-0">/</span>
        <span className="shrink-0">公开课备课</span>
        <span className="shrink-0">/</span>
        <span className="truncate font-medium text-foreground">表内乘法（一）</span>
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" size="sm" className="hidden sm:inline-flex">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          已保存 10:24
        </Button>
        <Button variant="secondary" size="sm" className="hidden sm:inline-flex">
          <Users className="h-4 w-4" />
          协作
        </Button>
        <Button variant="secondary" size="icon" aria-label="更多">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
