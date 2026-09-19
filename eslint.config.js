'use strict';

const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const importPlugin = require('eslint-plugin-import');
const nPlugin = require('eslint-plugin-n');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = tseslint.config(
  {
    ignores: [
      'node_modules',
      'dist',
      'generated',
      '**/*.d.ts',
      'test/lambda-e2e',
      'eslint.config.js',
      'jest.config.js',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  importPlugin.flatConfigs.recommended,
  nPlugin.configs['flat/recommended'],
  prettierRecommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
    rules: {
      semi: ['error', 'always'],
      'import/no-extraneous-dependencies': ['error', {}],
      'n/no-unsupported-features/es-syntax': 'off',
      // eslint-plugin-n resolves extensionless relative imports using strict Node ESM
      // rules, which always fails for TS's extensionless imports regardless of target;
      // tsc (via `npm run build`) already reports genuinely missing modules as TS2307.
      'n/no-missing-import': 'off',
      'prettier/prettier': 'error',
      'block-scoped-var': 'error',
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'eol-last': 'error',
      'prefer-arrow-callback': 'error',
      'no-trailing-spaces': 'error',
      // considerDefaultExhaustiveForUnions restores the pre-v6 behavior this codebase's
      // switches rely on: a `default:` case handling an optional field's `undefined`
      // (e.g. an optional SecurityMode) counts as exhaustive, rather than requiring an
      // explicit `case undefined:` on every such switch.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        {considerDefaultExhaustiveForUnions: true},
      ],
      // A leading underscore is this codebase's convention for a required-but-intentionally-
      // unused parameter (e.g. Map.forEach's key when only the value is needed).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
      ],
      // Promoted from the default warning to an error: the codebase has no non-null
      // assertions, so keep new ones from creeping back in.
      '@typescript-eslint/no-non-null-assertion': 'error',
      // This codebase's established idiom for an optional callback is
      // `this.callback && this.callback(...)` as a standalone statement (e.g.
      // openTelemetryClient.ts, metricsSetups.ts) rather than an `if`. allowShortCircuit
      // keeps that idiom legal instead of requiring it be rewritten everywhere.
      '@typescript-eslint/no-unused-expressions': [
        'error',
        {allowShortCircuit: true},
      ],
      // Same reasoning: every public method has an explicit return type, so keep it
      // enforced rather than defaulting to a warning.
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      quotes: ['warn', 'single', {avoidEscape: true}],
      'no-restricted-properties': [
        'error',
        {
          object: 'describe',
          property: 'only',
        },
        {
          object: 'it',
          property: 'only',
        },
      ],
      // async without await is often an error and in other uses it obfuscates
      // the intent of the developer. Functions are async when they want to await.
      'require-await': 'error',
      'import/no-duplicates': 'error',
    },
  }
);
