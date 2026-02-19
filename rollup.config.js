import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/PrefetchManager.ts',
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
  external: (id) => id === 'ol' || id.startsWith('ol/'),
  plugins: [
    resolve(),
    commonjs(),
    typescript({tsconfig: './tsconfig.json'})
  ]
};
