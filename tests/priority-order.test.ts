import assert from 'assert/strict';
import PrefetchPlanner from '../src/PrefetchPlanner.ts';
import PrefetchStats from '../src/PrefetchStats.ts';
import { PrefetchCategory } from '../src/PrefetchConstants.ts';
import TileState from 'ol/TileState.js';

const createTileRange = (minX: number, maxX: number, minY: number, maxY: number) => ({
  minX,
  maxX,
  minY,
  maxY,
  containsXY: (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY,
});

const createTileGrid = () => ({
  getTileRangeForExtentAndZ: (extent: number[], _z: number) => {
    const width = extent[2] - extent[0];
    if (width > 300) {
      return createTileRange(0, 1, 0, 1);
    }
    return createTileRange(0, 0, 0, 0);
  },
});

const createSource = () => {
  const tileGrid = createTileGrid();
  return {
    getTileGridForProjection: () => tileGrid,
    getTile: () => ({
      getState: () => TileState.IDLE,
    }),
  };
};

const createLayer = (name: string) => {
  const source = createSource();
  return {
    name,
    getSource: () => source,
  };
};

const createView = () => ({
  isDef: () => true,
  getState: () => ({ center: [0, 0], resolution: 1, rotation: 0 }),
  getZoom: () => 5,
  getProjection: () => ({}),
  getResolutionForZoom: () => 1,
});

const createMap = () => ({
  getView: () => createView(),
  getSize: () => [256, 256] as [number, number],
  getPixelRatio: () => 1,
});

const buildQueue = (categoryPriorities: Record<string, number>) => {
  const planner = new PrefetchPlanner(2);
  const stats = new PrefetchStats();
  const activeLayer = createLayer('active');
  const bgLayerLow = createLayer('bg-low');
  const bgLayerHigh = createLayer('bg-high');
  const backgroundLayers = [
    { layer: bgLayerLow, priority: 1 },
    { layer: bgLayerHigh, priority: 10 },
  ];

  const nextTarget = { center: [100, 100] as [number, number], zoom: 5 };
  const queue = planner.buildQueue(
    createMap() as any,
    activeLayer as any,
    backgroundLayers as any,
    nextTarget as any,
    categoryPriorities as any,
    stats,
  );

  return { queue, bgLayerLow, bgLayerHigh };
};

(() => {
  const priorities = {
    [PrefetchCategory.SPATIAL_ACTIVE]: 1,
    [PrefetchCategory.BACKGROUND_LAYERS_VIEWPORT]: 5,
    [PrefetchCategory.BACKGROUND_LAYERS_BUFFER]: 7,
    [PrefetchCategory.NEXT_NAV_ACTIVE]: 2,
    [PrefetchCategory.NEXT_NAV_BACKGROUND]: 6,
  };

  const { queue, bgLayerLow, bgLayerHigh } = buildQueue(priorities);
  assert.ok(queue.length > 0, 'queue should contain tasks');

  let lastPriority = -Infinity;
  for (const task of queue) {
    assert.ok(
      task.priority >= lastPriority,
      `priority order broken: ${task.priority} < ${lastPriority}`,
    );
    lastPriority = task.priority;
  }

  const bgTasks = queue.filter(
    (task) => task.category === PrefetchCategory.BACKGROUND_LAYERS_VIEWPORT,
  );
  assert.ok(bgTasks.length >= 2, 'expected background tasks for both layers');
  const lowIndex = bgTasks.findIndex((task) => (task.layer as unknown) === bgLayerLow);
  const highIndex = bgTasks.findIndex((task) => (task.layer as unknown) === bgLayerHigh);
  assert.ok(lowIndex !== -1 && highIndex !== -1, 'missing background layer tasks');
  assert.ok(lowIndex < highIndex, 'background layer priority ordering broken');
})();

(() => {
  const priorities = {
    [PrefetchCategory.SPATIAL_ACTIVE]: 3,
    [PrefetchCategory.BACKGROUND_LAYERS_VIEWPORT]: 5,
    [PrefetchCategory.BACKGROUND_LAYERS_BUFFER]: 7,
    [PrefetchCategory.NEXT_NAV_ACTIVE]: 1,
    [PrefetchCategory.NEXT_NAV_BACKGROUND]: 6,
  };

  const { queue } = buildQueue(priorities);
  const firstCategory = queue[0]?.category;
  assert.equal(
    firstCategory,
    PrefetchCategory.NEXT_NAV_ACTIVE,
    'expected next-nav tasks to be scheduled first when highest priority',
  );
})();

console.log('priority-order tests passed');
