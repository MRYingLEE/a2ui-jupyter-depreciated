/*
 * Copyright 2026 Google LLC
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

import {copyFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = path.join(root, 'dist');
const staticDirectory = path.resolve(root, '../../../python/a2ui_jupyter/src/a2ui_jupyter/static');

await mkdir(distDirectory, {recursive: true});
await mkdir(staticDirectory, {recursive: true});
await build({
  entryPoints: [path.join(root, 'src/widget.tsx')],
  outfile: path.join(distDirectory, 'widget.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
});
await copyFile(path.join(distDirectory, 'widget.js'), path.join(staticDirectory, 'widget.js'));
await copyFile(path.join(distDirectory, 'widget.css'), path.join(staticDirectory, 'widget.css'));
