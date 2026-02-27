# openlayers-prefetching

Prefetching Manager for OpenLayers - An extension to optimize tile loading and improve map performance.

## Overview

This extension provides customizable prefetching of tiles. Multiple common prefecthing scenarios are covered:

- **Spatial Prefetching**: Prefetch neighbouring tiles outside of current viewport, to facilitate panning.
- **Layers Prefetching**: Prefetch layers that are not yet visible (i.e background / stacked layers) with the same viewport as the current active layer.
- **Next-Location**: Sometimes the locations where to navigate to next can be anticipated. We can preload tiles for these.

We allow assigning **priorities** on what to prefetch first:

- **Prefetching-Type Prioritization** Spatial / Background / Next-Location / Next-Location-Background
- **Per Layer priorities**: Some layers might typically be neded before others. Priorities per layer allow customizing this.

## Installation

```bash
npm install openlayers-prefetching
```

## Usage & Examples

**Hosted Demo**
https://rohansaw.github.io/openlayers-prefetching/examples/advanced/advanced.html


**Try it locally**
See the [examples](./examples) directory for complete working examples:

We provide an example that allows a user to visualize Timeseries of Sentinel-2 Imagery over Europe from
[Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a).
The timeseries of imagery is preloaded before the user navigates to the corresponding layers.

To run the examples locally, you will have to point the package name to the local dist build insteaf of the `unpkg` link in `examples/advanced.html`. Then run:

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
