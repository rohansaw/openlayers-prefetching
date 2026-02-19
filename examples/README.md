# Examples

This directory contains example implementations of the OpenLayers Prefetching extension.

## Running the Examples

### Using npm
```bash
npm run serve
```

Then open your browser to:
- Basic example: http://localhost:8080/basic.html
- Advanced example: http://localhost:8080/advanced.html

### Using Python
```bash
cd examples
python -m http.server 8080
```

### Using PHP
```bash
cd examples
php -S localhost:8080
```

## Available Examples

### basic.html
A simple example demonstrating:
- Basic PrefetchManager initialization
- Enable/disable controls
- Adjustable prefetch distance
- Manual prefetch triggering
- Queue management

### advanced.html
An advanced example showing:
- Statistics tracking
- Performance monitoring
- More aggressive prefetch settings
- Real-time updates during map interaction

## Notes

The examples currently use placeholder implementations of PrefetchManager.
Once you implement the actual logic in `src/PrefetchManager.js`, you can:

1. Build the library: `npm run build`
2. Update the examples to import from `../dist/PrefetchManager.esm.js`
3. Test the real implementation

## Integration Pattern

When you add your implementation, the basic integration pattern is:

```javascript
import PrefetchManager from 'openlayers-prefetching';

const map = new ol.Map({ /* your config */ });

const prefetchManager = new PrefetchManager({
  map: map,
  prefetchDistance: 1,      // tiles to prefetch around viewport
  maxConcurrent: 4,         // max simultaneous requests
  enabled: true             // start enabled
});
```
