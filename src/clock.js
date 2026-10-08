// One pausable clock for everything that eases or waits, so it can all be
// frozen together (a page that embeds the workspace does so while off screen).
export const CANCELLED = Symbol("cancelled");

const running = new Set();
let paused = false;
let last = performance.now();

function frame(now) {
  // a throttled or backgrounded tab returns with one long frame; cap it
  const delta = paused ? 0 : Math.min(now - last, 64);
  last = now;
  if (delta) for (const tick of [...running]) tick(delta);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

export function setPaused(value) {
  paused = value;
}

// Calls `step(progress)` each frame across `duration` ms of unpaused time.
// Rejects with CANCELLED as soon as `alive()` turns false.
export function tween(duration, step, alive = () => true) {
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    const tick = (delta) => {
      if (!alive()) {
        running.delete(tick);
        reject(CANCELLED);
        return;
      }
      elapsed += delta;
      const progress = duration > 0 ? Math.min(1, elapsed / duration) : 1;
      if (step) step(progress);
      if (progress === 1) {
        running.delete(tick);
        resolve();
      }
    };
    running.add(tick);
  });
}

export const wait = (duration, alive) => tween(duration, null, alive);

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOut = (t) => 1 - (1 - t) ** 3;
