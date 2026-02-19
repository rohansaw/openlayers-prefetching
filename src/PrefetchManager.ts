/**
 * @module ol/prefetch/PrefetchManager
 */
import {listen, unlistenByKey} from 'ol/events.js';
import MapEventType from 'ol/MapEventType.js';
import {PrefetchCategory, DEFAULT_CATEGORY_PRIORITIES} from './PrefetchConstants';
import type {PrefetchCategoryKey} from './PrefetchConstants';
import PrefetchStats from './PrefetchStats';
import PrefetchPlanner from './PrefetchPlanner';
import PrefetchScheduler from './PrefetchScheduler';
import TileLoader from './TileLoader';
import type OLMap from 'ol/Map.js';
import type TileQueue from 'ol/TileQueue.js';
import type {Coordinate} from 'ol/coordinate.js';
import type {
  BackgroundLayerEntry,
  PrefetchManagerOptions,
  PrefetchTarget,
  PrefetchTask,
  PrefetchTileLayer,
} from './PrefetchTypes';
import type {EventsKey} from 'ol/events.js';

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
  private userInteracting_ = false;
  private idleTimeout_: ReturnType<typeof setTimeout> | null = null;

  private backgroundLayers_: BackgroundLayerEntry[] = [];
  private activeLayer_: PrefetchTileLayer | null = null;
  private nextTarget_: PrefetchTarget | null = null;
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
    this.maxConcurrentPrefetches_ = options.maxConcurrentPrefetches ?? 12;
    this.idleDelay_ = options.idleDelay ?? 300;
    this.enabled_ = options.enabled ?? true;

    this.planner_ = new PrefetchPlanner(options.spatialBufferFactor ?? 1.5);

    this.loader_ = new TileLoader({
      onSlotFreed: () => {
        if (!this.userInteracting_) {
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
    this.loader_.abandonAll(this.stats_);
    this.queue_ = this.queue_.filter(
      (task) =>
        task.category === PrefetchCategory.NEXT_NAV_ACTIVE ||
        task.category === PrefetchCategory.NEXT_NAV_BACKGROUND,
    );
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
    if (!this.userInteracting_ && this.enabled_) {
      this.scheduler_.scheduleTick();
    }
  }

  private rebuildQueue_(): void {
    if (this.userInteracting_) {
      return;
    }
    this.queue_ = this.planner_.buildQueue(
      this.map_,
      this.activeLayer_,
      this.backgroundLayers_,
      this.nextTarget_,
      this.categoryPriorities_,
      this.stats_,
    );
    this.notifyStats_();
  }

  private fillSlots_(): void {
    if (!this.enabled_ || this.userInteracting_) {
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
      if (this.userInteracting_) {
        break;
      }
      if (mapTileQueue && mapTileQueue.getTilesLoading() > 0) {
        this.scheduler_.scheduleTick();
        break;
      }
      const task = this.queue_.shift();
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
    const mapAny = this.map_ as unknown as {tileQueue_?: TileQueue};
    return mapAny.tileQueue_ ?? null;
  }

  private notifyStats_(): void {
    const snapshot = this.stats_.getSnapshot(
      this.queue_.length,
      this.loader_.activeCount,
      this.userInteracting_,
      this.nextTarget_,
      this.categoryPriorities_,
    );
    this.stats_.notify(snapshot);
  }

  addBackgroundLayer(layer: PrefetchTileLayer, priority = 0): void {
    const exists = this.backgroundLayers_.some((e) => e.layer === layer);
    if (!exists) {
      this.backgroundLayers_.push({layer, priority});
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

  getBackgroundLayers(): Array<{layer: PrefetchTileLayer; priority: number}> {
    return this.backgroundLayers_.map((e) => ({layer: e.layer, priority: e.priority}));
  }

  setActiveLayer(layer: PrefetchTileLayer): void {
    this.activeLayer_ = layer;
    this.rebuildQueue_();
    this.scheduler_.scheduleTick();
  }

  setNextTarget(center: Coordinate, zoom: number): void {
    this.nextTarget_ = {center, zoom};
    this.rebuildQueue_();
    this.scheduler_.scheduleTick();
  }

  clearNextTarget(): void {
    this.nextTarget_ = null;
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
    return {...this.categoryPriorities_};
  }

  onStats(callback: (stats: import('./PrefetchTypes').PrefetchStats) => void): void {
    this.stats_.onStats(callback);
  }

  getStats(): import('./PrefetchTypes').PrefetchStats {
    return this.stats_.getSnapshot(
      this.queue_.length,
      this.loader_.activeCount,
      this.userInteracting_,
      this.nextTarget_,
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
    this.nextTarget_ = null;
  }
}

export default PrefetchManager;
export {PrefetchCategory};
