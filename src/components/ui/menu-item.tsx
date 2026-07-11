import * as React from "react";
import { cn } from "@/lib/utils";

export type MenuItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode;
  danger?: boolean;
};

export const MenuItem = React.forwardRef<HTMLButtonElement, MenuItemProps>(
  ({ icon, danger = false, disabled, className, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-45",
        danger ? "text-destructive hover:bg-destructive/5 focus-visible:bg-destructive/5" : "text-foreground",
        className,
      )}
      {...props}
    >
      {icon && <span className={cn("shrink-0 text-muted-foreground", danger && "text-destructive")}>{icon}</span>}
      {children}
    </button>
  ),
);
MenuItem.displayName = "MenuItem";
