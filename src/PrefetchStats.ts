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

  notify(stats: PrefetchStatsSnapshot): void {
    for (const cb of this.listeners_) {
      cb(stats);
    }
  }

  dispose(): void {
    this.listeners_ = [];
    this.errorLog_ = [];
  }
}

export default PrefetchStats;
