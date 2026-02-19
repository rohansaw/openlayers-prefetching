import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/PrefetchManager.js',
  output: [
    {
      file: 'dist/PrefetchManager.js',
      format: 'umd',
      name: 'PrefetchManager',
      sourcemap: true
    },
    {
      file: 'dist/PrefetchManager.esm.js',
      format: 'esm',
      sourcemap: true
    }
  ],
  external: ['ol', 'ol/Map', 'ol/layer/Tile', 'ol/source/OSM'],
  plugins: [
    resolve(),
    commonjs()
  ]
};
