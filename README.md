# openlayers-prefetching

Prefetching Manager for OpenLayers - An extension to optimize tile loading and improve map performance.

## Overview

This extension provides intelligent tile prefetching for OpenLayers maps, loading tiles around the current viewport before they're needed. This results in smoother panning and zooming experiences for users.

## Installation

```bash
npm install openlayers-prefetching
```

Or with yarn:

```bash
yarn add openlayers-prefetching
```

## Quick Start

```javascript
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import PrefetchManager from 'openlayers-prefetching';

// Create your OpenLayers map
const map = new Map({
  target: 'map',
  layers: [
    new TileLayer({
      source: new OSM()
    })
  ],
  view: new View({
    center: [0, 0],
    zoom: 2
  })
});

// Initialize the PrefetchManager
const prefetchManager = new PrefetchManager({
  map: map,
  prefetchDistance: 1,  // Number of tiles to prefetch around viewport
  maxConcurrent: 4,     // Maximum concurrent tile requests
  enabled: true         // Enable prefetching immediately
});
```

## API

### Constructor Options

- `map` (required): The OpenLayers map instance
- `prefetchDistance` (default: 1): Number of tiles to prefetch around the viewport
- `maxConcurrent` (default: 4): Maximum number of concurrent tile requests
- `enabled` (default: true): Whether prefetching is enabled on initialization

### Methods

- `enable()`: Enable tile prefetching
- `disable()`: Disable tile prefetching
- `setPrefetchDistance(distance)`: Set the prefetch distance
- `getPrefetchDistance()`: Get the current prefetch distance
- `setMaxConcurrent(max)`: Set the maximum concurrent requests
- `getMaxConcurrent()`: Get the maximum concurrent requests
- `prefetch()`: Manually trigger prefetching for the current viewport
- `clearQueue()`: Clear the prefetch queue
- `dispose()`: Clean up and remove all event listeners

## Examples

See the [examples](./examples) directory for complete working examples:

- **basic.html**: Simple integration with controls
- **advanced.html**: Advanced usage with statistics

To run the examples locally:

```bash
npm run serve
```

Then open http://localhost:8080/basic.html in your browser.

## Development

### Building

```bash
npm run build
```

This will create:
- `dist/PrefetchManager.js` - UMD build
- `dist/PrefetchManager.esm.js` - ES module build

### Development Mode

```bash
npm run dev
```

Runs the build in watch mode for development.

## Browser Compatibility

This extension works with OpenLayers 7.x and 8.x.

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
