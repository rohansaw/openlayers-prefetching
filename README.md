# openlayers-prefetching

Prefetching Manager for OpenLayers - An extension to optimize tile loading and improve map performance.

## Overview

This extension provides customizable prefetching of tiles. Multiple common prefecthing scenarios are covered:

- Spatial: Prefetch tiles outside of current viewport
- Layers: Prefetch layers that are not yet visible with the same viewport as from the current active layer
- Next-Location: Sometimes the locations where to navigate to next are already known. We can preload tiles for these.

We allow assigning priorities on what to prefetch first:

- Spatial/Background/Next/NextBackground
- Per Layer priorities: Some layers might typically be neded before others, so priorities per layer allow customizing this.

## Installation

```bash
npm install openlayers-prefetching
```

## Examples

See the [examples](./examples) directory for complete working examples:

We provide an example that allows a user to visualize Timeseries of Sentinel-2 Imagery over Europe from
[Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a).
The timeseries of imagery is preloaded before the user navigates to the corresponding layers.

Hosted advanced demo:
https://rohansaw.github.io/openlayers-prefetching/examples/advanced/advanced.html


To run the examples locally:

```bash
npm run build && npm run serve
```

Then open http://localhost:8080/examples in your browser.

## Compatibility

This extension was only tested with Openlayers 8.0. It may or may not be compatible with other versions.

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
