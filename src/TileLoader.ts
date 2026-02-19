/**
 * @module ol/prefetch/TileLoader
 */
import TileState from 'ol/TileState.js';
import {getCategoryName} from './PrefetchConstants';
import type {Listener} from 'ol/events.js';
import type OLMap from 'ol/Map.js';
import type Tile from 'ol/Tile.js';
import type {PrefetchError, PrefetchTask} from './PrefetchTypes';
import type PrefetchStats from './PrefetchStats';

export interface TileLoaderCallbacks {
  onSlotFreed: () => void;
  onStatsChanged: () => void;
}

/**
 * Manages in-flight prefetch downloads. Supports abandoning all in-flight
 * loads on user interaction so they don't block slots or compete with the
 * map's own tile queue for HTTP connections.
 */
class TileLoader {
  private callbacks_: TileLoaderCallbacks;
  private loading_: Map<string, {task: PrefetchTask; unlisten: () => void}> = new Map();

  constructor(callbacks: TileLoaderCallbacks) {
    this.callbacks_ = callbacks;
  }

  get activeCount(): number {
    return this.loading_.size;
  }

  startTask(task: PrefetchTask, map: OLMap, stats: PrefetchStats): void {
    const source = task.layer.getSource();
    if (!source) {
      return;
    }

    const projection = map.getView().getProjection();
    const pixelRatio =
      (map as unknown as {getPixelRatio?: () => number}).getPixelRatio?.() ?? 1;
    const category = task.category;

    let tile: Tile | null;
    try {
      tile = source.getTile(
        task.tileCoord[0],
        task.tileCoord[1],
        task.tileCoord[2],
        pixelRatio,
        projection,
      ) as Tile | null;
    } catch {
      return;
    }

    if (!tile) {
      return;
    }

    const state = tile.getState();

    if (state === TileState.LOADED) {
      stats.recordAlreadyLoaded(category);
      return;
    }

    if (state === TileState.LOADING) {
      return;
    }

    this.loading_.set(task.id, {task, unlisten: () => {}});
    stats.recordLoadingStart(category);

    const taskId = task.id;

  const onTileChange: Listener = () => {
      const newState = tile.getState();
      if (
        newState !== TileState.LOADED &&
        newState !== TileState.ERROR &&
        newState !== TileState.EMPTY
      ) {
        return;
      }

  tile.removeEventListener('change', onTileChange);

      if (!this.loading_.has(taskId)) {
        return;
      }

      this.loading_.delete(taskId);
      stats.recordLoadingEnd(category);

      if (newState === TileState.LOADED) {
        stats.recordLoaded(category);
      } else if (newState === TileState.ERROR) {
        stats.recordError(category, this.buildErrorEntry_(task, tile));
      } else {
        stats.recordEmpty(category);
      }

      this.callbacks_.onStatsChanged();
      this.callbacks_.onSlotFreed();
    };

    this.loading_.set(taskId, {
      task,
  unlisten: () => tile.removeEventListener('change', onTileChange),
    });

  tile.addEventListener('change', onTileChange);
    tile.load();
  }

  abandonAll(stats: PrefetchStats): void {
    for (const [, entry] of this.loading_) {
      entry.unlisten();
      stats.recordLoadingEnd(entry.task.category);
    }
    this.loading_.clear();
  }

  private buildErrorEntry_(task: PrefetchTask, tile: Tile): PrefetchError {
    const layerName = task.layer.get('name') || task.layer.get('label') || 'unknown';

    const anyTile = tile as unknown as {_prefetchError?: string};
    let reason = anyTile._prefetchError;
    if (!reason) {
      const src = task.layer.getSource() as unknown as {getUrls?: () => string[]};
      if (src && typeof src.getUrls === 'function') {
        const urls = src.getUrls();
        if (urls && urls.length > 0) {
          try {
            reason = `Tile load failed (${new URL(urls[0]).hostname})`;
          } catch {
            reason = 'Tile load failed';
          }
        }
      }
      if (!reason) {
        reason = 'Tile load failed';
      }
    }

    return {
      tileCoord: task.tileCoord,
      category: getCategoryName(task.category),
      layerName,
      reason,
      timestamp: Date.now(),
    };
  }

  dispose(): void {
    for (const [, entry] of this.loading_) {
      entry.unlisten();
    }
    this.loading_.clear();
  }
}

export default TileLoader;
