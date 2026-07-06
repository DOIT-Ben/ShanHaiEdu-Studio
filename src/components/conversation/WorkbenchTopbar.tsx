"use client";

import { CheckCircle2, MoreHorizontal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WorkbenchTopbar() {
  return (
    <div className="flex items-center justify-between gap-4 px-8 py-6">
      <nav className="flex min-w-0 items-center gap-4 text-sm text-muted-foreground" aria-label="当前位置">
        <span>ShanHaiEdu</span>
        <span>/</span>
        <span>公开课备课</span>
        <span>/</span>
        <span className="truncate font-medium text-foreground">表内乘法（一）</span>
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" size="sm" className="hidden sm:inline-flex">
          <CheckCircle2 className="h-4 w-4 text-primary" />
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

