"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

type ResizableHandleProps = {
  width: number;
  min?: number;
  max?: number;
  onChange: (width: number) => void;
};

export function ResizableHandle({ width, min = 300, max = 520, onChange }: ResizableHandleProps) {
  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;

    function move(pointerEvent: PointerEvent) {
      const nextWidth = Math.min(max, Math.max(min, startWidth - (pointerEvent.clientX - startX)));
      onChange(nextWidth);
    }

    function stop() {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <button
      type="button"
      aria-label="调整产物预览宽度"
      onPointerDown={startResize}
      className="group absolute inset-y-0 left-0 z-10 flex w-3 -translate-x-1/2 cursor-col-resize items-center justify-center outline-none"
    >
      <span className="h-full w-px bg-border transition group-hover:bg-muted-foreground/45 group-focus-visible:bg-muted-foreground/60" />
    </button>
  );
}
