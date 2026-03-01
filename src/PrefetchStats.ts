/**
 * @module ol/prefetch/PrefetchStats
 */
import { PrefetchCategory, createInitialCategoryCounts } from './PrefetchConstants';
import type { PrefetchCategoryKey } from './PrefetchConstants';
import type {
  PrefetchError,
  PrefetchStats as PrefetchStatsSnapshot,
  PrefetchCategoryStats,
  PrefetchTarget,
} from './PrefetchTypes';

/**
 * Tracks prefetch statistics, per-category counts, error logs,
 * and notifies listeners on changes.
 */
class PrefetchStats {
  private loadedCount_ = 0;
  private errorCount_ = 0;

  private categoryCounts_: Record<PrefetchCategoryKey, PrefetchCategoryStats> =
    createInitialCategoryCounts();

  private errorLog_: PrefetchError[] = [];

  private listeners_: Array<(stats: PrefetchStatsSnapshot) => void> = [];

  get categoryCounts(): Record<PrefetchCategoryKey, PrefetchCategoryStats> {
    return this.categoryCounts_;
  }

  resetQueuedCounts(): void {
    for (const key in this.categoryCounts_) {
      this.categoryCounts_[key as PrefetchCategoryKey].queued = 0;
      this.categoryCounts_[key as PrefetchCategoryKey].loading = 0;
    }
  }

  recordQueued(category: PrefetchCategoryKey): void {
    if (this.categoryCounts_[category]) {
      this.categoryCounts_[category].queued++;
    }
  }

  setQueuedCount(category: PrefetchCategoryKey, queued: number): void {
    if (this.categoryCounts_[category]) {
      this.categoryCounts_[category].queued = queued;
    }
  }

  recordLoadingStart(category: PrefetchCategoryKey): void {
    if (this.categoryCounts_[category]) {
      this.categoryCounts_[category].loading++;
      this.categoryCounts_[category].queued = Math.max(
        0,
        this.categoryCounts_[category].queued - 1,
      );
    }
  }

  recordLoadingEnd(category: PrefetchCategoryKey): void {
    if (this.categoryCounts_[category]) {
      this.categoryCounts_[category].loading = Math.max(
        0,
        this.categoryCounts_[category].loading - 1,
      );
    }
  }

  recordAlreadyLoaded(category: PrefetchCategoryKey): void {
    this.loadedCount_++;
    if (this.categoryCounts_[category]) {
      this.categoryCounts_[category].loaded++;
      this.categoryCounts_[category].queued = Math.max(
        0,
        this.categoryCounts_[category].queued - 1,
      );
    }
  }

  recordLoaded(category: PrefetchCategoryKey): void {
    this.loadedCount_++;
    if (this.categoryCounts_[category]) {
      this.categoryCounts_[category].loaded++;
    }
  }

  recordError(category: PrefetchCategoryKey, errorEntry: PrefetchError): void {
    this.errorCount_++;
    if (this.categoryCounts_[category]) {
      this.categoryCounts_[category].errors++;
    }
    this.errorLog_.unshift(errorEntry);
    if (this.errorLog_.length > 50) {
      this.errorLog_.length = 50;
    }
  }

  recordEmpty(category: PrefetchCategoryKey): void {
    if (this.categoryCounts_[category]) {
      this.categoryCounts_[category].errors++;
    }
  }

  getSnapshot(
    queueLength: number,
    loadingSize: number,
    paused: boolean,
    nextTargets: PrefetchTarget[],
    categoryPriorities: Record<PrefetchCategoryKey, number>,
  ): PrefetchStatsSnapshot {
    return {
      queued: queueLength,
      loading: loadingSize,
      loaded: this.loadedCount_,
      errors: this.errorCount_,
      paused,
      spatialActive: { ...this.categoryCounts_[PrefetchCategory.SPATIAL_ACTIVE] },
      bgViewport: {
        ...this.categoryCounts_[PrefetchCategory.BACKGROUND_LAYERS_VIEWPORT],
      },
      bgBuffer: { ...this.categoryCounts_[PrefetchCategory.BACKGROUND_LAYERS_BUFFER] },
      nextNavActive: { ...this.categoryCounts_[PrefetchCategory.NEXT_NAV_ACTIVE] },
      nextNavBackground: {
        ...this.categoryCounts_[PrefetchCategory.NEXT_NAV_BACKGROUND],
      },
      nextTargets: nextTargets.map((t) => ({ center: t.center, zoom: t.zoom })),
      recentErrors: this.errorLog_.slice(),
      categoryPriorities: { ...categoryPriorities },
    };
  }

  onStats(callback: (stats: PrefetchStatsSnapshot) => void): void {
    this.listeners_.push(callback);
  }

  /**
   * Register a one-shot callback that fires as soon as `queued + loading === 0`
   * (i.e. the prefetch engine has nothing left to do).  If it is already idle at
   * the time of the call the callback fires on the very next `notify()` tick.
   *
   * @param callback  Called once, then automatically removed.
   * @param maxWaitMs Optional safety timeout (default 60 s).  The callback is
   *                  invoked even if the queue never fully drains (e.g. network
   *                  errors keep some tiles from loading).
   */
  onIdle(callback: () => void, maxWaitMs = 60_000): void {
    let fired = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fire = () => {
      if (fired) return;
      fired = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      // Remove this listener from the list
      const idx = this.listeners_.indexOf(listener);
      if (idx >= 0) this.listeners_.splice(idx, 1);
      callback();
    };

    const listener = (stats: PrefetchStatsSnapshot) => {
      if (stats.queued === 0 && stats.loading === 0) fire();
    };

    this.listeners_.push(listener);
    timer = setTimeout(fire, maxWaitMs);
  }

  notify(stats: PrefetchStatsSnapshot): void {
    // Snapshot the array before iterating — listeners may remove themselves
    // (e.g. onIdle callbacks) during iteration.
    const cbs = this.listeners_.slice();
    for (const cb of cbs) {
      cb(stats);
    }
  }

  dispose(): void {
    this.listeners_ = [];
    this.errorLog_ = [];
  }
}

export default PrefetchStats;
