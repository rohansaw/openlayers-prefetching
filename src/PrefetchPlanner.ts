/**
 * @module ol/prefetch/PrefetchPlanner
 */
import { getUid } from 'ol/util.js';
import TileState from 'ol/TileState.js';
import { getForViewAndSize, buffer as bufferExtent } from 'ol/extent.js';
import { PrefetchCategory } from './PrefetchConstants';
import type { PrefetchCategoryKey } from './PrefetchConstants';
import type Map from 'ol/Map.js';
import type TileSource from 'ol/source/Tile.js';
import type Tile from 'ol/Tile.js';
import type Projection from 'ol/proj/Projection.js';
import type { Extent } from 'ol/extent.js';
import type { TileCoord } from 'ol/tilecoord.js';
import type {
  BackgroundLayerEntry,
  PrefetchTarget,
  PrefetchTask,
  PrefetchTileLayer,
} from './PrefetchTypes';
import type PrefetchStats from './PrefetchStats';

interface PrefetchPlannerContext {
  queue: PrefetchTask[];
  seenTiles: Set<string>;
  pixelRatio: number;
  stats: PrefetchStats;
}

/**
 * Responsible for deciding WHAT tiles to load.
 *
 * Builds the prioritised prefetch queue by inspecting the current view state,
 * active layer, background layers, and next navigation target.
 */
class PrefetchPlanner {
  private spatialBufferFactor_: number;
  private lastNextTargetsKey_: string | null = null;

  /**
   * @param spatialBufferFactor Factor to expand viewport for spatial prefetch.
   */
  constructor(spatialBufferFactor: number) {
    this.spatialBufferFactor_ = spatialBufferFactor;
  }

  /**
   * Builds a queue containing only spatial-buffer tiles for the active layer.
   * Used during user interaction so the active layer keeps loading smoothly
   * while background and next-nav prefetch is paused.
   */
  buildActiveSpatialQueue(
    map: Map,
    activeLayer: PrefetchTileLayer,
    categoryPriorities: Record<PrefetchCategoryKey, number>,
    stats: PrefetchStats,
  ): PrefetchTask[] {
    const queue: PrefetchTask[] = [];
    const seenTiles = new Set<string>();

    const view = map.getView();
    if (!view || !view.isDef()) {
      return queue;
    }

    const mapSize = map.getSize();
    if (!mapSize) {
      return queue;
    }

    const viewState = view.getState();
    const viewExtent = getForViewAndSize(
      viewState.center,
      viewState.resolution,
      viewState.rotation,
      mapSize,
    );

    const zoom = view.getZoom();
    if (zoom === undefined) {
      return queue;
    }
    const z = Math.round(zoom);
    const projection = view.getProjection();
    const pixelRatio =
      (map as unknown as { getPixelRatio?: () => number }).getPixelRatio?.() ?? 1;

    const ctx: PrefetchPlannerContext = { queue, seenTiles, pixelRatio, stats };

    this.enqueueSpatialBuffer_(
      ctx,
      activeLayer,
      viewExtent,
      z,
      projection,
      categoryPriorities[PrefetchCategory.SPATIAL_ACTIVE],
      PrefetchCategory.SPATIAL_ACTIVE,
    );

    queue.sort((a, b) => a.priority - b.priority);
    return queue;
  }

  buildQueue(
    map: Map,
    activeLayer: PrefetchTileLayer | null,
    backgroundLayers: BackgroundLayerEntry[],
    nextTargets: PrefetchTarget[],
    categoryPriorities: Record<PrefetchCategoryKey, number>,
    stats: PrefetchStats,
  ): PrefetchTask[] {
    const queue: PrefetchTask[] = [];
    const seenTiles = new Set<string>();

    const nextTargetsKey =
      nextTargets.length > 0
        ? nextTargets.map((t) => `${t.center[0]}|${t.center[1]}|${t.zoom}`).join(';')
        : null;
    const preserveNextCounts =
      nextTargetsKey !== null && nextTargetsKey === this.lastNextTargetsKey_;
    const prevNextNavActive = preserveNextCounts
      ? stats.categoryCounts[PrefetchCategory.NEXT_NAV_ACTIVE].queued
      : 0;
    const prevNextNavBackground = preserveNextCounts
      ? stats.categoryCounts[PrefetchCategory.NEXT_NAV_BACKGROUND].queued
      : 0;

    stats.resetQueuedCounts();

    const view = map.getView();
    if (!view || !view.isDef()) {
      return queue;
    }

    const mapSize = map.getSize();
    if (!mapSize) {
      return queue;
    }

    const viewState = view.getState();
    const viewExtent = getForViewAndSize(
      viewState.center,
      viewState.resolution,
      viewState.rotation,
      mapSize,
    );

    const zoom = view.getZoom();
    if (zoom === undefined) {
      return queue;
    }
    const z = Math.round(zoom);
    const projection = view.getProjection();
    const pixelRatio =
      (map as unknown as { getPixelRatio?: () => number }).getPixelRatio?.() ?? 1;

    const ctx: PrefetchPlannerContext = { queue, seenTiles, pixelRatio, stats };

    if (activeLayer) {
      this.enqueueSpatialBuffer_(
        ctx,
        activeLayer,
        viewExtent,
        z,
        projection,
        categoryPriorities[PrefetchCategory.SPATIAL_ACTIVE],
        PrefetchCategory.SPATIAL_ACTIVE,
      );
    }

    for (const entry of backgroundLayers) {
      if (entry.layer === activeLayer) {
        continue;
      }
      const subPriority = entry.priority * 0.001;
      this.enqueueViewportTiles_(
        ctx,
        entry.layer,
        viewExtent,
        z,
        projection,
        categoryPriorities[PrefetchCategory.BACKGROUND_LAYERS_VIEWPORT] + subPriority,
        PrefetchCategory.BACKGROUND_LAYERS_VIEWPORT,
      );
    }

    // Enqueue each next target in order. Later targets get a small priority
    // offset so target[0] tiles are always loaded before target[1], etc.
    for (let i = 0; i < nextTargets.length; i++) {
      const nextTarget = nextTargets[i];
      const targetOffset = i * 0.1;
      const nextZ = Math.round(nextTarget.zoom);
      const nextResolution = view.getResolutionForZoom(nextTarget.zoom);
      const nextExtent = getForViewAndSize(nextTarget.center, nextResolution, 0, mapSize);

      if (activeLayer) {
        this.enqueueViewportTiles_(
          ctx,
          activeLayer,
          nextExtent,
          nextZ,
          projection,
          categoryPriorities[PrefetchCategory.NEXT_NAV_ACTIVE] + targetOffset,
          PrefetchCategory.NEXT_NAV_ACTIVE,
        );
        this.enqueueSpatialBuffer_(
          ctx,
          activeLayer,
          nextExtent,
          nextZ,
          projection,
          categoryPriorities[PrefetchCategory.NEXT_NAV_ACTIVE] + targetOffset,
          PrefetchCategory.NEXT_NAV_ACTIVE,
        );
      }

      for (const entry of backgroundLayers) {
        if (entry.layer === activeLayer) {
          continue;
        }
        const subPriority = entry.priority * 0.001;
        this.enqueueViewportTiles_(
          ctx,
          entry.layer,
          nextExtent,
          nextZ,
          projection,
          categoryPriorities[PrefetchCategory.NEXT_NAV_BACKGROUND] +
            targetOffset +
            subPriority,
          PrefetchCategory.NEXT_NAV_BACKGROUND,
        );
      }
    }

    if (nextTargets.length === 0) {
      this.lastNextTargetsKey_ = null;
    } else {
      this.lastNextTargetsKey_ = nextTargetsKey;
      if (preserveNextCounts) {
        if (stats.categoryCounts[PrefetchCategory.NEXT_NAV_ACTIVE].queued === 0) {
          stats.setQueuedCount(PrefetchCategory.NEXT_NAV_ACTIVE, prevNextNavActive);
        }
        if (stats.categoryCounts[PrefetchCategory.NEXT_NAV_BACKGROUND].queued === 0) {
          stats.setQueuedCount(
            PrefetchCategory.NEXT_NAV_BACKGROUND,
            prevNextNavBackground,
          );
        }
      }
    }

    queue.sort((a, b) => a.priority - b.priority);
    return queue;
  }

  private enqueueViewportTiles_(
    ctx: PrefetchPlannerContext,
    layer: PrefetchTileLayer,
    extent: Extent,
    z: number,
    projection: Projection,
    priority: number,
    category: PrefetchCategoryKey,
  ): void {
    const source = layer.getSource() as TileSource | null;
    if (!source) {
      return;
    }

    const tileGrid = source.getTileGridForProjection(projection);
    const tileRange = tileGrid.getTileRangeForExtentAndZ(extent, z);

    for (let x = tileRange.minX; x <= tileRange.maxX; x++) {
      for (let y = tileRange.minY; y <= tileRange.maxY; y++) {
        this.enqueueTile_(ctx, layer, source, [z, x, y], projection, priority, category);
      }
    }
  }

  private enqueueSpatialBuffer_(
    ctx: PrefetchPlannerContext,
    layer: PrefetchTileLayer,
    viewExtent: Extent,
    z: number,
    projection: Projection,
    priority: number,
    category: PrefetchCategoryKey,
  ): void {
    const source = layer.getSource() as TileSource | null;
    if (!source) {
      return;
    }

    const tileGrid = source.getTileGridForProjection(projection);

    const extentWidth = viewExtent[2] - viewExtent[0];
    const extentHeight = viewExtent[3] - viewExtent[1];
    const bufferX = (extentWidth * (this.spatialBufferFactor_ - 1)) / 2;
    const bufferY = (extentHeight * (this.spatialBufferFactor_ - 1)) / 2;
    const bufferValue = Math.max(bufferX, bufferY);

    const bufferedExtent = bufferExtent(viewExtent, bufferValue);
    const bufferedTileRange = tileGrid.getTileRangeForExtentAndZ(bufferedExtent, z);
    const viewportTileRange = tileGrid.getTileRangeForExtentAndZ(viewExtent, z);

    for (let x = bufferedTileRange.minX; x <= bufferedTileRange.maxX; x++) {
      for (let y = bufferedTileRange.minY; y <= bufferedTileRange.maxY; y++) {
        if (viewportTileRange.containsXY(x, y)) {
          continue;
        }
        this.enqueueTile_(ctx, layer, source, [z, x, y], projection, priority, category);
      }
    }
  }

  private enqueueTile_(
    ctx: PrefetchPlannerContext,
    layer: PrefetchTileLayer,
    source: TileSource,
    tileCoord: TileCoord,
    projection: Projection,
    priority: number,
    category: PrefetchCategoryKey,
  ): void {
    const layerKey = getUid(layer);
    const tileKey = `${layerKey}/${tileCoord[0]}/${tileCoord[1]}/${tileCoord[2]}`;

    if (ctx.seenTiles.has(tileKey)) {
      return;
    }
    ctx.seenTiles.add(tileKey);

    let tile: Tile | null;
    try {
      tile = source.getTile(
        tileCoord[0],
        tileCoord[1],
        tileCoord[2],
        ctx.pixelRatio,
        projection,
      ) as Tile | null;
    } catch {
      return;
    }

    if (!tile) {
      return;
    }

    const state = tile.getState();
    if (state === TileState.LOADED || state === TileState.LOADING) {
      return;
    }

    ctx.queue.push({
      id: tileKey,
      priority,
      category,
      layer,
      tileCoord,
      timestamp: Date.now(),
    });

    ctx.stats.recordQueued(category);
  }
}

export default PrefetchPlanner;
