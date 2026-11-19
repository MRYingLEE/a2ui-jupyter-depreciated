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

import path from 'node:path';
import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: [
      {
        find: '@a2ui/react/styles',
        replacement: path.resolve('../../renderers/react/src/styles/index.ts'),
      },
      {
        find: '@a2ui/react',
        replacement: path.resolve('../../renderers/react/src/index.ts'),
      },
      {
        find: '@a2ui/web_core/styles/index',
        replacement: path.resolve('../../core/web_core/src/v0_8/styles/index.ts'),
      },
      {
        find: '@a2ui/web_core/catalogs/basic/v1',
        replacement: path.resolve('../../core/web_core/src/catalogs/basic/v1/index.ts'),
      },
      {
        find: '@a2ui/web_core/v1_0',
        replacement: path.resolve('../../core/web_core/src/v1_0/index.ts'),
      },
      {
        find: '@a2ui/web_core/universal',
        replacement: path.resolve('../../core/web_core/src/universal/index.ts'),
      },
      {
        find: '@a2ui/web_core/v0_9/basic_catalog',
        replacement: path.resolve('../../core/web_core/src/v0_9/basic_catalog/index.ts'),
      },
      {
        find: '@a2ui/web_core/v0_9/universal',
        replacement: path.resolve('../../core/web_core/src/v0_9/universal/index.ts'),
      },
      {
        find: '@a2ui/web_core/v0_9',
        replacement: path.resolve('../../core/web_core/src/v0_9/index.ts'),
      },
      {
        find: '@a2ui/web_core/universal',
        replacement: path.resolve('../../core/web_core/src/universal/index.ts'),
      },
      {
        find: '@a2ui/web_core',
        replacement: path.resolve('../../core/web_core/src/index.ts'),
      },
    ],
  },
});
