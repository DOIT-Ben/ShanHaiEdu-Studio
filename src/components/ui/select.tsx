import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "group inline-flex h-11 min-w-36 items-center justify-between gap-2 rounded-2xl border-2 border-[#d4e3df] bg-card px-3.5 text-sm outline-none transition-[background-color,border-color,box-shadow] duration-150 hover:border-[#8fd4c7] hover:bg-[#f7fbfa] focus-visible:border-[#68a999] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] data-[state=open]:border-[#7fcfc1] data-[state=open]:bg-white data-[state=open]:shadow-[0_0_0_3px_rgba(127,207,193,0.14)] disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180 group-data-[state=open]:text-[#367d6d]" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  position = "popper",
  sideOffset = 6,
  align = "start",
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn("z-50 max-h-[min(320px,var(--radix-select-content-available-height))] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-card p-0 shadow-[var(--shadow-popover)]", className)}
        {...props}
      >
      <SelectPrimitive.Viewport className="max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-y-auto">{props.children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn("relative flex min-h-12 cursor-default items-center px-4 pr-11 text-sm outline-none transition-colors first:rounded-t-[15px] last:rounded-b-[15px] data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-[#edf7f4] data-[highlighted]:text-[#174d40] data-[state=checked]:bg-[#f2f4f3] data-[state=checked]:font-medium data-[state=checked]:text-[#167467]", className)}
      {...props}
    >
      <span className="absolute right-4 flex h-4 w-4 items-center justify-center text-[#0fae98]">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
