/**
 * @module ol/prefetch/PrefetchManager
 */
import { listen, unlistenByKey } from 'ol/events.js';
import MapEventType from 'ol/MapEventType.js';
import { PrefetchCategory, DEFAULT_CATEGORY_PRIORITIES } from './PrefetchConstants';
import type { PrefetchCategoryKey } from './PrefetchConstants';
import PrefetchStats from './PrefetchStats';
import PrefetchPlanner from './PrefetchPlanner';
import PrefetchScheduler from './PrefetchScheduler';
import TileLoader from './TileLoader';
import type OLMap from 'ol/Map.js';
import type TileQueue from 'ol/TileQueue.js';
import type { Coordinate } from 'ol/coordinate.js';
import type {
  BackgroundLayerEntry,
  PrefetchManagerOptions,
  PrefetchTarget,
  PrefetchTask,
  PrefetchTileLayer,
} from './PrefetchTypes';
import type { EventsKey } from 'ol/events.js';

/**
 * Manages controlled prefetching of tiles across multiple layers and locations.
 *
 * Priority order:
 * 1. User interactions (pan/zoom) always get absolute priority (managed by OL's TileQueue).
 * 2. Spatial prefetching: tiles around the visible viewport for the active layer.
 * 3. Background layer prefetching: load tiles for hidden layers at current viewport.
 * 4. Anticipated navigation prefetching: preload tiles at the next expected location.
 *
 * When the user interacts with the map (pan/zoom), all prefetching is paused
 * and only resumes after the user stops interacting.
 */
class PrefetchManager {
  private map_: OLMap;
  private maxConcurrentPrefetches_: number;
  private idleDelay_: number;
  private enabled_: boolean;
  private loadActiveDuringInteraction_: boolean;
  private userInteracting_ = false;
  private idleTimeout_: ReturnType<typeof setTimeout> | null = null;

  private backgroundLayers_: BackgroundLayerEntry[] = [];
  private activeLayer_: PrefetchTileLayer | null = null;
  private nextTargets_: PrefetchTarget[] = [];
  private excludedLayers_: Set<PrefetchTileLayer> = new Set();
  private categoryPriorities_: Record<PrefetchCategoryKey, number> = {
    ...DEFAULT_CATEGORY_PRIORITIES,
  };

  private queue_: PrefetchTask[] = [];

  private stats_: PrefetchStats = new PrefetchStats();
  private planner_: PrefetchPlanner;
  private loader_: TileLoader;
  private scheduler_: PrefetchScheduler;

  private listenerKeys_: EventsKey[] = [];

  constructor(options: PrefetchManagerOptions) {
    this.map_ = options.map;
    this.maxConcurrentPrefetches_ = options.maxConcurrentPrefetches ?? 16;
    this.idleDelay_ = options.idleDelay ?? 80;
    this.enabled_ = options.enabled ?? true;
    this.loadActiveDuringInteraction_ = options.loadActiveDuringInteraction ?? true;
    if (options.excludedLayers) {
      this.excludedLayers_ = new Set(options.excludedLayers);
    }

    this.planner_ = new PrefetchPlanner(options.spatialBufferFactor ?? 1.5);

    this.loader_ = new TileLoader({
      onSlotFreed: () => {
        if (!this.userInteracting_ || this.loadActiveDuringInteraction_) {
          this.fillSlots_();
        }
      },
      onStatsChanged: () => this.notifyStats_(),
    });

    this.scheduler_ = new PrefetchScheduler(options.tickInterval ?? 200, {
      onRebuildNeeded: () => this.rebuildQueue_(),
      onFillSlots: () => this.fillSlots_(),
      onStatsChanged: () => this.notifyStats_(),
    });

    this.setupListeners_();
  }

  private setupListeners_(): void {
    const map = this.map_;
    this.listenerKeys_.push(
      listen(map, MapEventType.MOVESTART, this.onMoveStart_, this),
      listen(map, MapEventType.MOVEEND, this.onMoveEnd_, this),
      listen(map, MapEventType.POSTRENDER, this.onPostRender_, this),
    );
  }

  private onMoveStart_(): void {
    this.userInteracting_ = true;
    if (this.idleTimeout_) {
      clearTimeout(this.idleTimeout_);
      this.idleTimeout_ = null;
    }

    if (this.loadActiveDuringInteraction_) {
      // Drop background / next-nav in-flight loads but keep active-layer ones.
      this.loader_.abandonNonActive(this.activeLayer_, this.stats_);
      // Keep only active-layer spatial tasks and next-nav tasks in the queue.
      this.queue_ = this.queue_.filter(
        (task) =>
          (task.category === PrefetchCategory.SPATIAL_ACTIVE &&
            task.layer === this.activeLayer_) ||
          task.category === PrefetchCategory.NEXT_NAV_ACTIVE ||
          task.category === PrefetchCategory.NEXT_NAV_BACKGROUND,
      );
    } else {
      this.loader_.abandonAll(this.stats_);
      this.queue_ = this.queue_.filter(
        (task) =>
          task.category === PrefetchCategory.NEXT_NAV_ACTIVE ||
          task.category === PrefetchCategory.NEXT_NAV_BACKGROUND,
      );
    }

    this.stats_.resetQueuedCounts();
    for (const task of this.queue_) {
      this.stats_.recordQueued(task.category);
    }
    this.scheduler_.dispose();
    this.notifyStats_();
  }

  private onMoveEnd_(): void {
    if (this.idleTimeout_) {
      clearTimeout(this.idleTimeout_);
    }
    this.idleTimeout_ = setTimeout(() => {
      this.userInteracting_ = false;
      this.rebuildQueue_();
      this.scheduler_.scheduleTick();
      this.notifyStats_();
    }, this.idleDelay_);
  }

  private onPostRender_(): void {
    if (!this.enabled_) {
      return;
    }
    if (!this.userInteracting_ || this.loadActiveDuringInteraction_) {
      this.scheduler_.scheduleTick();
    }
  }

  private rebuildQueue_(): void {
    // During interaction, only rebuild the active-layer spatial portion of the queue.
    if (this.userInteracting_) {
      if (
        !this.loadActiveDuringInteraction_ ||
        !this.activeLayer_ ||
        this.excludedLayers_.has(this.activeLayer_)
      ) {
        return;
      }
      const activeSpatial = this.planner_.buildActiveSpatialQueue(
        this.map_,
        this.activeLayer_,
        this.categoryPriorities_,
        this.stats_,
      );
      // Merge: keep existing next-nav entries, replace spatial ones.
      const nextNavTasks = this.queue_.filter(
        (t) =>
          t.category === PrefetchCategory.NEXT_NAV_ACTIVE ||
          t.category === PrefetchCategory.NEXT_NAV_BACKGROUND,
      );
      this.queue_ = [...activeSpatial, ...nextNavTasks];
      this.queue_.sort((a, b) => a.priority - b.priority);
      this.notifyStats_();
      return;
    }

    // Exclude layers from all planner inputs.
    const effectiveActiveLayer =
      this.activeLayer_ && !this.excludedLayers_.has(this.activeLayer_)
        ? this.activeLayer_
        : null;
    const effectiveBackgroundLayers = this.backgroundLayers_.filter(
      (e) => !this.excludedLayers_.has(e.layer),
    );

    this.queue_ = this.planner_.buildQueue(
      this.map_,
      effectiveActiveLayer,
      effectiveBackgroundLayers,
      this.nextTargets_,
      this.categoryPriorities_,
      this.stats_,
    );
    this.notifyStats_();
  }

  private fillSlots_(): void {
    if (!this.enabled_) {
      return;
    }

    // During interaction, only allow active-layer spatial tasks through.
    const interactionFilter =
      this.userInteracting_ && this.loadActiveDuringInteraction_
        ? (task: PrefetchTask) =>
          task.category === PrefetchCategory.SPATIAL_ACTIVE &&
          task.layer === this.activeLayer_
        : null;

    if (this.userInteracting_ && !interactionFilter) {
      return;
    }

    if (this.queue_.length === 0 && this.loader_.activeCount === 0) {
      this.notifyStats_();
      return;
    }

    const mapTileQueue = this.getMapTileQueue_();

    while (
      this.loader_.activeCount < this.maxConcurrentPrefetches_ &&
      this.queue_.length > 0
    ) {
      if (mapTileQueue && mapTileQueue.getTilesLoading() > 0) {
        this.scheduler_.scheduleTick();
        break;
      }

      // Find the next eligible task (respecting interaction filter).
      let taskIndex = -1;
      if (interactionFilter) {
        taskIndex = this.queue_.findIndex(interactionFilter);
        if (taskIndex === -1) {
          break;
        }
      } else {
        taskIndex = 0;
      }

      const task = this.queue_.splice(taskIndex, 1)[0];
      if (!task) {
        break;
      }
      this.loader_.startTask(task, this.map_, this.stats_);
    }

    if (this.queue_.length > 0 && this.loader_.activeCount === 0) {
      this.scheduler_.scheduleTick();
    }

    this.notifyStats_();
  }

  private getMapTileQueue_(): TileQueue | null {
    const mapAny = this.map_ as unknown as { tileQueue_?: TileQueue };
    return mapAny.tileQueue_ ?? null;
  }

  private notifyStats_(): void {
    const snapshot = this.stats_.getSnapshot(
      this.queue_.length,
      this.loader_.activeCount,
      this.userInteracting_,
      this.nextTargets_,
      this.categoryPriorities_,
    );
    this.stats_.notify(snapshot);
  }

  addBackgroundLayer(layer: PrefetchTileLayer, priority = 0): void {
    const exists = this.backgroundLayers_.some((e) => e.layer === layer);
    if (!exists) {
      this.backgroundLayers_.push({ layer, priority });
      this.backgroundLayers_.sort((a, b) => a.priority - b.priority);
      this.rebuildQueue_();
      this.scheduler_.scheduleTick();
    }
  }

  removeBackgroundLayer(layer: PrefetchTileLayer): void {
    const idx = this.backgroundLayers_.findIndex((e) => e.layer === layer);
    if (idx >= 0) {
      this.backgroundLayers_.splice(idx, 1);
      this.rebuildQueue_();
    }
  }

  setBackgroundLayerPriority(layer: PrefetchTileLayer, priority: number): void {
    const entry = this.backgroundLayers_.find((e) => e.layer === layer);
    if (entry) {
      entry.priority = priority;
      this.backgroundLayers_.sort((a, b) => a.priority - b.priority);
      this.rebuildQueue_();
      this.scheduler_.scheduleTick();
    }
  }

  getBackgroundLayers(): Array<{ layer: PrefetchTileLayer; priority: number }> {
    return this.backgroundLayers_.map((e) => ({ layer: e.layer, priority: e.priority }));
  }

  setActiveLayer(layer: PrefetchTileLayer): void {
    this.activeLayer_ = layer;
    this.rebuildQueue_();
    this.scheduler_.scheduleTick();
  }

  /**
   * Exclude a layer from all prefetching.  If the layer is currently the
   * active layer its spatial prefetch will stop; if it is a background layer
   * its background-viewport/buffer prefetch will stop.  The layer is NOT
   * removed from the background-layers registry — re-including it restores
   * prefetch without needing to re-add it.
   */
  excludeLayer(layer: PrefetchTileLayer): void {
    if (!this.excludedLayers_.has(layer)) {
      this.excludedLayers_.add(layer);
      this.rebuildQueue_();
      this.scheduler_.scheduleTick();
    }
  }

  /**
   * Re-enable prefetching for a previously excluded layer.
   */
  includeLayer(layer: PrefetchTileLayer): void {
    if (this.excludedLayers_.has(layer)) {
      this.excludedLayers_.delete(layer);
      this.rebuildQueue_();
      this.scheduler_.scheduleTick();
    }
  }

  /**
   * Returns true if the layer is currently excluded from prefetching.
   */
  isLayerExcluded(layer: PrefetchTileLayer): boolean {
    return this.excludedLayers_.has(layer);
  }

  /**
   * Returns a snapshot array of all currently excluded layers.
   */
  getExcludedLayers(): PrefetchTileLayer[] {
    return Array.from(this.excludedLayers_);
  }

  /**
   * Replace the entire list of next targets with the provided array.
   */
  setNextTargets(targets: Array<{ center: Coordinate; zoom: number }>): void {
    this.nextTargets_ = targets.map((t) => ({ center: t.center, zoom: t.zoom }));
    this.rebuildQueue_();
    this.scheduler_.scheduleTick();
  }

  /**
   * Add a single target to the end of the next-targets list.
   */
  addNextTarget(center: Coordinate, zoom: number): void {
    this.nextTargets_.push({ center, zoom });
    this.rebuildQueue_();
    this.scheduler_.scheduleTick();
  }

  /**
   * Remove the next target at the given index.
   */
  removeNextTarget(index: number): void {
    if (index >= 0 && index < this.nextTargets_.length) {
      this.nextTargets_.splice(index, 1);
      this.rebuildQueue_();
      this.scheduler_.scheduleTick();
    }
  }

  /**
   * Clear all next targets.
   */
  clearNextTargets(): void {
    this.nextTargets_ = [];
    this.rebuildQueue_();
    this.scheduler_.scheduleTick();
  }

  /**
   * Return a copy of the current next-targets list.
   */
  getNextTargets(): PrefetchTarget[] {
    return this.nextTargets_.map((t) => ({ center: t.center, zoom: t.zoom }));
  }

  /**
   * Convenience: set a single next target (replaces any existing targets).
   */
  setNextTarget(center: Coordinate, zoom: number): void {
    this.setNextTargets([{ center, zoom }]);
  }

  /**
   * Convenience: clear all next targets (alias for clearNextTargets).
   */
  clearNextTarget(): void {
    this.clearNextTargets();
  }

  setEnabled(enabled: boolean): void {
    this.enabled_ = enabled;
    this.scheduler_.enabled = enabled;
    if (enabled) {
      this.rebuildQueue_();
      this.scheduler_.scheduleTick();
    }
    this.notifyStats_();
  }

  getEnabled(): boolean {
    return this.enabled_;
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrentPrefetches_ = Math.max(1, max);
    this.fillSlots_();
  }

  getMaxConcurrent(): number {
    return this.maxConcurrentPrefetches_;
  }

  setCategoryPriorities(priorities: Partial<Record<PrefetchCategoryKey, number>>): void {
    for (const key in priorities) {
      const typedKey = key as PrefetchCategoryKey;
      if (typedKey in this.categoryPriorities_ && priorities[typedKey] !== undefined) {
        this.categoryPriorities_[typedKey] = priorities[typedKey] as number;
      }
    }
    this.rebuildQueue_();
    this.scheduler_.scheduleTick();
    this.notifyStats_();
  }

  getCategoryPriorities(): Record<PrefetchCategoryKey, number> {
    return { ...this.categoryPriorities_ };
  }

  onStats(callback: (stats: import('./PrefetchTypes').PrefetchStats) => void): void {
    this.stats_.onStats(callback);
  }

  getStats(): import('./PrefetchTypes').PrefetchStats {
    return this.stats_.getSnapshot(
      this.queue_.length,
      this.loader_.activeCount,
      this.userInteracting_,
      this.nextTargets_,
      this.categoryPriorities_,
    );
  }

  dispose(): void {
    for (const key of this.listenerKeys_) {
      unlistenByKey(key);
    }
    this.listenerKeys_.length = 0;

    if (this.idleTimeout_) {
      clearTimeout(this.idleTimeout_);
    }

    this.scheduler_.dispose();
    this.loader_.dispose();
    this.stats_.dispose();

    this.queue_ = [];
    this.backgroundLayers_ = [];
    this.activeLayer_ = null;
    this.nextTargets_ = [];
    this.excludedLayers_.clear();
  }
}

export default PrefetchManager;
export { PrefetchCategory };
