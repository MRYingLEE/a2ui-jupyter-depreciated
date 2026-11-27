/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = path.join(root, 'dist');

await rm(distDirectory, {recursive: true, force: true});
await mkdir(distDirectory, {recursive: true});
// Both bundles are self-contained so hosts with their own React or A2UI copies
// can load them. `kernel.js` has no dependencies and stays small.
await build({
  entryPoints: {
    form: path.join(root, 'src/index.ts'),
    kernel: path.join(root, 'src/kernel.ts'),
  },
  outdir: distDirectory,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  define: {'process.env.NODE_ENV': '"production"'},
});

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const result = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.build.json')], {
  stdio: 'inherit',
});
if (result.status !== 0) {
  throw new Error('Building type declarations failed');
}
