export interface GridWindow {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
}

export interface GridWindowOptions {
  width: number;
  height: number;
  cellSize: number;
  gap?: number;
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
  overscan?: number;
}

export function getVisibleGridWindow({
  width,
  height,
  cellSize,
  gap = 0,
  scrollLeft,
  scrollTop,
  viewportWidth,
  viewportHeight,
  overscan = 2
}: GridWindowOptions): GridWindow {
  const stride = Math.max(1, cellSize + gap);
  const startX = clamp(Math.floor(scrollLeft / stride) - overscan, 0, Math.max(0, width - 1));
  const startY = clamp(Math.floor(scrollTop / stride) - overscan, 0, Math.max(0, height - 1));
  const endX = clamp(Math.ceil((scrollLeft + viewportWidth) / stride) + overscan, startX, Math.max(0, width - 1));
  const endY = clamp(Math.ceil((scrollTop + viewportHeight) / stride) + overscan, startY, Math.max(0, height - 1));

  return { startX, endX, startY, endY };
}

export function getVisibleGridCells(window: GridWindow): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = window.startY; y <= window.endY; y += 1) {
    for (let x = window.startX; x <= window.endX; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
