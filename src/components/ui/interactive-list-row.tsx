import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type InteractiveListRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  active?: boolean;
  selected?: boolean;
  attention?: boolean;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  showArrow?: boolean;
  compact?: boolean;
  contained?: boolean;
};

export function InteractiveListRow({
  active = false,
  selected = false,
  attention = false,
  leading,
  title,
  subtitle,
  meta,
  trailing,
  showArrow = false,
  compact = false,
  contained = false,
  disabled,
  className,
  type = "button",
  ...props
}: InteractiveListRowProps) {
  const isSelected = active || selected;

  return (
    <button
      type={type}
      disabled={disabled}
      data-interactive-list-row
      data-selected={isSelected || undefined}
      data-attention={attention || undefined}
      aria-pressed={selected || undefined}
      className={cn(
        "group relative flex min-h-11 w-full items-center gap-3 overflow-hidden rounded-lg border border-transparent px-4 py-3 text-left outline-none transition-[background-color,border-color,color] duration-150",
        "enabled:hover:border-[#b9d8cf] enabled:hover:bg-[#eaf5f1] active:bg-[#deeee8] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
        "disabled:cursor-default disabled:opacity-55",
        isSelected && "border-[#b9d8cf] bg-[#eaf5f1]",
        attention && "border-[#e5c7c1] bg-[#fff7f5]",
        compact && "gap-2 rounded-md px-3 py-2",
        contained && "max-w-full",
        className,
      )}
      {...props}
    >
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-medium text-foreground transition-colors duration-150 group-hover:text-[#174d40]", isSelected && "text-[#174d40]")}>{title}</span>
        {subtitle && <span className="mt-1 block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
      {trailing}
      {showArrow && (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-transparent text-muted-foreground transition-colors duration-150 group-enabled:group-hover:bg-white group-enabled:group-hover:text-[#286657]">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
    </button>
  );
}
