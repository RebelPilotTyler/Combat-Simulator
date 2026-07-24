import { describe, expect, it, vi } from 'vitest';
import { createFrameQueue, type RequestFrame } from './frameQueue';

describe('frame queue', () => {
  it('coalesces values into one ordered callback per animation frame', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextHandle = 1;
    const requestFrame: RequestFrame = (callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    };
    const onFrame = vi.fn();
    const queue = createFrameQueue(onFrame, requestFrame, (handle) => callbacks.delete(handle));

    queue.enqueue('first');
    queue.enqueue('second');
    queue.enqueue('third');

    expect(callbacks.size).toBe(1);
    const callback = [...callbacks.values()][0];
    callbacks.clear();
    callback(16);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenLastCalledWith(['first', 'second', 'third']);

    queue.enqueue('next-frame');
    expect(callbacks.size).toBe(1);
  });

  it('flushes queued values in order and cancels disposed work', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    const onFrame = vi.fn();
    const queue = createFrameQueue(
      onFrame,
      (callback) => {
        callbacks.set(7, callback);
        return 7;
      },
      (handle) => {
        cancelled.push(handle);
        callbacks.delete(handle);
      }
    );

    queue.enqueue(1);
    queue.enqueue(2);
    queue.flush();
    expect(cancelled).toEqual([7]);
    expect(onFrame).toHaveBeenCalledWith([1, 2]);

    queue.enqueue(3);
    queue.dispose();
    expect(cancelled).toEqual([7, 7]);
    expect(onFrame).toHaveBeenCalledTimes(1);
  });
});
