/**
 * @module ol/prefetch/PrefetchScheduler
 */
import type TileQueue from 'ol/TileQueue.js';
import type PrefetchStats from './PrefetchStats';

export interface PrefetchSchedulerCallbacks {
  onRebuildNeeded: () => void;
  onFillSlots: () => void;
  onStatsChanged: () => void;
}

/**
 * Responsible for WHEN to load.
 *
 * Manages the tick timer, checks preconditions (user interaction, map tile
 * queue draining), and signals the manager to fill download slots.
 */
class PrefetchScheduler {
  private tickInterval_: number;
  private callbacks_: PrefetchSchedulerCallbacks;
  private tickTimer_: ReturnType<typeof setTimeout> | null = null;
  private enabled_ = true;

  constructor(tickInterval: number, callbacks: PrefetchSchedulerCallbacks) {
    this.tickInterval_ = tickInterval;
    this.callbacks_ = callbacks;
  }

  set enabled(enabled: boolean) {
    this.enabled_ = enabled;
  }

  get enabled(): boolean {
    return this.enabled_;
  }

  scheduleTick(): void {
    if (this.tickTimer_ || !this.enabled_) {
      return;
    }
    this.tickTimer_ = setTimeout(() => {
      this.tickTimer_ = null;
      this.callbacks_.onRebuildNeeded();
      this.callbacks_.onFillSlots();
    }, this.tickInterval_);
  }

  runTick(
    userInteracting: boolean,
    mapTileQueue: TileQueue | null,
    stats: PrefetchStats,
  ): void {
    if (!this.enabled_ || userInteracting) {
      return;
    }

    if (mapTileQueue && mapTileQueue.getTilesLoading() > 0) {
      this.callbacks_.onStatsChanged();
      this.scheduleTick();
      return;
    }

    this.callbacks_.onRebuildNeeded();
    this.callbacks_.onFillSlots();
  }

  dispose(): void {
    if (this.tickTimer_) {
      clearTimeout(this.tickTimer_);
      this.tickTimer_ = null;
    }
  }
}

export default PrefetchScheduler;
