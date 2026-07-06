import { cn } from "@/lib/utils";

const stages = ["确定目标", "教学设计", "资源生成", "检查优化", "导出交付"];

export function StageProgress({ activeIndex = 2 }: { activeIndex?: number }) {
  return (
    <div className="px-4 pb-6 sm:px-8">
      <div className="thin-scrollbar flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-gutter:stable] sm:gap-3">
        {stages.map((stage, index) => {
          const active = index === activeIndex;
          const done = index < activeIndex;
          return (
            <div key={stage} className="flex min-w-[108px] shrink-0 items-center gap-2.5 lg:flex-1">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                  active && "border-input bg-[#eeeeef] text-foreground",
                  done && "border-border bg-card text-muted-foreground",
                  !active && !done && "border-border bg-card text-muted-foreground",
                )}
              >
                {index + 1}
              </div>
              <div className={cn("min-w-0 whitespace-nowrap text-sm", active ? "font-medium text-foreground" : "text-muted-foreground")}>
                {stage}
              </div>
              {index < stages.length - 1 && <div className="hidden h-px flex-1 bg-border/80 lg:block" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
