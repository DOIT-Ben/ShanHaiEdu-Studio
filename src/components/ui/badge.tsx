import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/20 bg-warning/10 text-warning",
  info: "border-info/20 bg-info/10 text-info",
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
  bronze: "border-bronze/25 bg-bronze/10 text-bronze",
};

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", tones[tone], className)}
      {...props}
    />
  );
}

