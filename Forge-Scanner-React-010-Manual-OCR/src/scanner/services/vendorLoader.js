/**
 * One-shot loader slot with dead-load recovery.
 *
 * A vendor library is loaded once and then reused. The hazard is a load that
 * never settles: a `<script>` that fires neither `load` nor `error`. Caching
 * that promise would make every later retry — and every later file — await a
 * corpse. So a load that rejects, times out or is cancelled clears the slot and
 * runs its cleanup, and the next caller starts a completely fresh load.
 *
 * Plain JavaScript with no DOM, so the Node suite exercises this exact code.
 */

export function createLoaderSlot() {
  let promise = null;
  let cleanup = null;

  const reset = () => {
    const previous = cleanup;
    promise = null;
    cleanup = null;
    if (!previous) return;
    try {
      previous();
    } catch {
      /* the resource was already gone */
    }
  };

  return {
    /** True while a load is cached and considered usable. */
    get loaded() {
      return promise !== null;
    },

    /**
     * @param start  begins the load, returning `{ promise, cleanup }`
     * @param guard  wraps the pending promise, normally with the watchdog
     */
    async get(start, guard) {
      if (!promise) {
        const started = start();
        promise = started.promise;
        cleanup = started.cleanup ?? null;
        // A rejection clears the slot even if nobody is awaiting it right now.
        started.promise.catch(() => {
          if (promise === started.promise) reset();
        });
      }

      const pending = promise;
      try {
        return await guard(pending);
      } catch (error) {
        // Timed out or cancelled: the promise may still be pending forever.
        if (promise === pending) reset();
        throw error;
      }
    },

    reset
  };
}
