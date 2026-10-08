import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await Promise.all([
  build({
    entryPoints: [new URL('../src/index.js', import.meta.url).pathname],
    outfile: new URL('../dist/index.js', import.meta.url).pathname,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    sourcemap: true,
    legalComments: 'eof',
  }),
  build({
    entryPoints: [new URL('../src/record-worker.js', import.meta.url).pathname],
    outfile: new URL('../dist/record-worker.js', import.meta.url).pathname,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    sourcemap: true,
    legalComments: 'eof',
  }),
]);
await copyFile(new URL('../src/index.d.ts', import.meta.url), new URL('../dist/index.d.ts', import.meta.url));
console.log(`Built browser package at ${new URL('../dist/', import.meta.url).pathname}`);
