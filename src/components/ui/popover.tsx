import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  align = "end",
  sideOffset = 8,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 w-80 rounded-[var(--surface-radius)] border border-[var(--surface-border)] bg-card p-3 text-card-foreground shadow-[var(--shadow-popover)] outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
