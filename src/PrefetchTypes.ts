/**
 * @module ol/prefetch/PrefetchTypes
 */
import type Map from 'ol/Map.js';
import type BaseTileLayer from 'ol/layer/BaseTile.js';
import type TileSource from 'ol/source/Tile.js';
import type {Coordinate} from 'ol/coordinate.js';
import type {TileCoord} from 'ol/tilecoord.js';
import type {PrefetchCategoryKey} from './PrefetchConstants';

export interface PrefetchTarget {
  center: Coordinate;
  zoom: number;
}

export type PrefetchTileLayer = BaseTileLayer<TileSource, any>;

export interface BackgroundLayerEntry {
  layer: PrefetchTileLayer;
  priority: number;
}

export interface PrefetchTask {
  id: string;
  priority: number;
  category: PrefetchCategoryKey;
  layer: PrefetchTileLayer;
  tileCoord: TileCoord;
  timestamp: number;
}

export interface PrefetchCategoryStats {
  queued: number;
  loading: number;
  loaded: number;
  errors: number;
}

export interface PrefetchError {
  tileCoord: TileCoord;
  category: string;
  layerName: string;
  reason: string;
  timestamp: number;
}

export interface PrefetchStats {
  queued: number;
  loading: number;
  loaded: number;
  errors: number;
  paused: boolean;
  spatialActive: PrefetchCategoryStats;
  bgViewport: PrefetchCategoryStats;
  bgBuffer: PrefetchCategoryStats;
  nextNavActive: PrefetchCategoryStats;
  nextNavBackground: PrefetchCategoryStats;
  nextTarget: {center: Coordinate; zoom: number} | null;
  recentErrors: PrefetchError[];
  categoryPriorities: Record<PrefetchCategoryKey, number>;
}

export interface PrefetchManagerOptions {
  map: Map;
  spatialBufferFactor?: number;
  maxConcurrentPrefetches?: number;
  idleDelay?: number;
  tickInterval?: number;
  enabled?: boolean;
  /**
   * When true (default), spatial tiles for the active layer continue loading
   * during pan and zoom so newly revealed tiles appear without delay.
   * Background and next-navigation prefetch is still paused during interaction.
   */
  loadActiveDuringInteraction?: boolean;
}
