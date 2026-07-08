"use client";

import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

type ResizableHandleProps = {
  width: number;
  min?: number;
  max?: number;
  onChange: (width: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
};

export function ResizableHandle({ width, min = 300, max = 460, onChange, onResizeStart, onResizeEnd }: ResizableHandleProps) {
  const resizingRef = useRef(false);

  function startResize(event: ReactMouseEvent<HTMLButtonElement> | ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (resizingRef.current) return;
    resizingRef.current = true;
    onResizeStart?.();
    const startX = event.clientX;
    const startWidth = width;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    let frame = 0;
    let nextWidth = startWidth;

    function move(moveEvent: MouseEvent | PointerEvent) {
      nextWidth = Math.min(max, Math.max(min, startWidth - (moveEvent.clientX - startX)));
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        onChange(nextWidth);
      });
    }

    function stop() {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      onChange(nextWidth);
      onResizeEnd?.();
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop, { once: true });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <button
      type="button"
      aria-label="调整产物预览宽度"
      onPointerDown={startResize}
      onMouseDown={startResize}
      style={{ zIndex: 1000 }}
      className="group absolute inset-y-0 left-0 flex w-6 cursor-col-resize items-center justify-center outline-none"
    >
      <span className="pointer-events-none h-full w-px bg-border transition group-hover:bg-muted-foreground/45 group-focus-visible:bg-muted-foreground/60" />
    </button>
  );
}
