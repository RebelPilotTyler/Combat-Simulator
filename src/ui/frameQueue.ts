export type RequestFrame = (callback: FrameRequestCallback) => number;
export type CancelFrame = (handle: number) => void;

export interface FrameQueue<T> {
  enqueue: (value: T) => void;
  flush: () => void;
  dispose: () => void;
}

export function createFrameQueue<T>(
  onFrame: (values: T[]) => void,
  requestFrame: RequestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame: CancelFrame = (handle) => cancelAnimationFrame(handle)
): FrameQueue<T> {
  let pending: T[] = [];
  let frameHandle: number | undefined;

  const applyPending = () => {
    frameHandle = undefined;
    if (pending.length === 0) {
      return;
    }
    const values = pending;
    pending = [];
    onFrame(values);
  };

  return {
    enqueue(value) {
      pending.push(value);
      if (frameHandle === undefined) {
        frameHandle = requestFrame(applyPending);
      }
    },
    flush() {
      if (frameHandle !== undefined) {
        cancelFrame(frameHandle);
      }
      applyPending();
    },
    dispose() {
      if (frameHandle !== undefined) {
        cancelFrame(frameHandle);
      }
      frameHandle = undefined;
      pending = [];
    }
  };
}
