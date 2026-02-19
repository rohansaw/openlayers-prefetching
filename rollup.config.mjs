import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

const isOpenLayersExternal = (id) => id === 'ol' || id.startsWith('ol/');

const globals = (id) => (isOpenLayersExternal(id) ? 'ol' : undefined);

export default {
  input: 'src/PrefetchManager.ts',
  output: [
    {
      file: 'dist/PrefetchManager.js',
      format: 'umd',
      name: 'PrefetchManager',
      sourcemap: true,
      globals,
      exports: 'named'
    },
    {
      file: 'dist/PrefetchManager.esm.js',
      format: 'esm',
      sourcemap: true
    }
  ],
  external: isOpenLayersExternal,
  plugins: [resolve(), commonjs(), typescript({tsconfig: './tsconfig.json'})]
};
