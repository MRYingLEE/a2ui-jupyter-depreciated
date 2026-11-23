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

const dist = new URL('../dist/', import.meta.url);
const target = new URL('../../../../python/a2ui_jupyter/src/a2ui_jupyter/static/', import.meta.url);

// Wireit cannot cache outputs outside this workspace, so copy on every build.
await mkdir(target, {recursive: true});
for (const name of ['widget.js', 'widget.css']) {
  await copyFile(new URL(name, dist), new URL(name, target));
}
