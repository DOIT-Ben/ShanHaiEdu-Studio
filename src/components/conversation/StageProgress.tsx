import { cn } from "@/lib/utils";

const stages = ["确定目标", "教学设计", "资源生成", "检查优化", "导出交付"];

export function StageProgress({ activeIndex = 2 }: { activeIndex?: number }) {
  return (
    <div className="px-8 pb-7">
      <div className="thin-scrollbar flex items-center gap-3 overflow-x-auto pb-1">
        {stages.map((stage, index) => {
          const active = index === activeIndex;
          const done = index < activeIndex;
          return (
            <div key={stage} className="flex min-w-28 items-center gap-3 lg:flex-1">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  active && "border-input bg-muted text-foreground",
                  done && "border-border bg-card text-muted-foreground",
                  !active && !done && "border-border bg-card text-muted-foreground",
                )}
              >
                {index + 1}
              </div>
              <div className={cn("min-w-0 text-sm", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {stage}
              </div>
              {index < stages.length - 1 && <div className="hidden h-px flex-1 bg-border lg:block" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
