import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-border bg-muted text-muted-foreground",
  warning: "border-border bg-muted text-muted-foreground",
  info: "border-border bg-muted text-muted-foreground",
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
  bronze: "border-border bg-muted text-muted-foreground",
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
