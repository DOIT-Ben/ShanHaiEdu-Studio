import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  inputSize?: "default" | "sm";
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputSize = "default", ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/65 focus-visible:border-[#68a999] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-60 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/25",
        inputSize === "default" ? "h-11" : "h-9",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
