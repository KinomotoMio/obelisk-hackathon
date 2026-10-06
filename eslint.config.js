// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Flat ESLint config for the Obelisk root (Core + CLI + packaging + tests).
// Scope: the root ESM/TS sources, including packages/core/src/ and
// packages/cli/src/. The Electron app has its own package and toolchain and is
// intentionally excluded (see docs/adr/0003).

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'app/**',
      'dist/**',
      // Workspace build output (tsc emits .js and .d.ts here).
      'packages/*/dist/**',
      'release/**',
      '.dev.docs/**',
      '.obelisk/**',
      '.claude/**',
      // chain/ is a standalone Hardhat project; lint its sources, not its
      // generated build output.
      'chain/artifacts/**',
      'chain/cache/**',
      'chain/types/**',
      'chain/coverage/**',
      // service/ is a standalone Cloudflare Worker project; wrangler writes
      // bundles here during `wrangler dev`.
      'service/.wrangler/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Empty catch is an intentional pattern here (best-effort JSON.parse etc.).
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The web reader (#10) runs in the browser, not Node.
    files: ['service/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Provider adapters parse untyped external transcript JSON; `any` at those
      // boundaries is deliberate, not a smell.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
