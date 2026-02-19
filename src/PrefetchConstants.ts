/**
 * @module ol/prefetch/PrefetchConstants
 */
import type {PrefetchCategoryStats} from './PrefetchTypes';

export const PrefetchCategory = {
  SPATIAL_ACTIVE: 'spatial',
  BACKGROUND_LAYERS_VIEWPORT: 'bgViewport',
  BACKGROUND_LAYERS_BUFFER: 'bgBuffer',
  NEXT_NAV_ACTIVE: 'nextNavActive',
  NEXT_NAV_BACKGROUND: 'nextNavBackground',
} as const;

export type PrefetchCategoryKey =
  typeof PrefetchCategory[keyof typeof PrefetchCategory];

export const DEFAULT_CATEGORY_PRIORITIES: Record<PrefetchCategoryKey, number> = {
  [PrefetchCategory.SPATIAL_ACTIVE]: 1,
  [PrefetchCategory.BACKGROUND_LAYERS_VIEWPORT]: 2,
  [PrefetchCategory.BACKGROUND_LAYERS_BUFFER]: 3,
  [PrefetchCategory.NEXT_NAV_ACTIVE]: 4,
  [PrefetchCategory.NEXT_NAV_BACKGROUND]: 5,
};

export function getCategoryName(category: PrefetchCategoryKey | string): string {
  switch (category) {
    case PrefetchCategory.SPATIAL_ACTIVE:
      return 'Spatial (active)';
    case PrefetchCategory.BACKGROUND_LAYERS_VIEWPORT:
      return 'BG viewport';
    case PrefetchCategory.BACKGROUND_LAYERS_BUFFER:
      return 'BG buffer';
    case PrefetchCategory.NEXT_NAV_ACTIVE:
      return 'Next nav (active)';
    case PrefetchCategory.NEXT_NAV_BACKGROUND:
      return 'Next nav (BG)';
    default:
      return `Category ${category}`;
  }
}

export function createInitialCategoryCounts(): Record<PrefetchCategoryKey, PrefetchCategoryStats> {
  return {
    [PrefetchCategory.SPATIAL_ACTIVE]: {queued: 0, loading: 0, loaded: 0, errors: 0},
    [PrefetchCategory.BACKGROUND_LAYERS_VIEWPORT]: {queued: 0, loading: 0, loaded: 0, errors: 0},
    [PrefetchCategory.BACKGROUND_LAYERS_BUFFER]: {queued: 0, loading: 0, loaded: 0, errors: 0},
    [PrefetchCategory.NEXT_NAV_ACTIVE]: {queued: 0, loading: 0, loaded: 0, errors: 0},
    [PrefetchCategory.NEXT_NAV_BACKGROUND]: {queued: 0, loading: 0, loaded: 0, errors: 0},
  };
}
