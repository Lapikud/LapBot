import js from '@eslint/js';
import type { Linter } from 'eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import { configs as sonarConfigs } from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';

const javascriptFiles = ['**/*.{js,mjs,cjs,jsx}'];
const typescriptFiles = ['**/*.{ts,mts,cts,tsx}'];
const sourceFiles = [...javascriptFiles, ...typescriptFiles];

const qualityRules: Linter.RulesRecord = {
  'no-alert': 'error',
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-debugger': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-new-wrappers': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-constant-binary-expression': 'error',
  'no-promise-executor-return': 'error',
  'no-async-promise-executor': 'error',
  'no-unmodified-loop-condition': 'error',
  'no-unreachable-loop': 'error',
  'no-template-curly-in-string': 'error',
  'no-useless-call': 'error',
  'no-useless-concat': 'error',
  'no-useless-return': 'error',
  'no-else-return': 'error',
  'no-lonely-if': 'error',
  'no-param-reassign': 'error',
  'no-shadow': 'error',
  'no-use-before-define': 'off',
  'no-void': 'off',

  'array-callback-return': ['error', { checkForEach: true }],
  'consistent-return': 'error',
  'constructor-super': 'error',
  'default-case-last': 'error',
  'default-param-last': 'error',
  eqeqeq: ['error', 'always'],
  curly: ['error', 'all'],
  'dot-notation': 'error',
  'guard-for-in': 'error',
  radix: 'error',
  yoda: 'error',

  'object-shorthand': ['error', 'always'],
  'prefer-const': 'error',
  'prefer-template': 'error',
  'prefer-object-spread': 'error',
  'prefer-rest-params': 'error',
  'prefer-spread': 'error',
  'prefer-exponentiation-operator': 'error',
  'prefer-numeric-literals': 'error',
  'prefer-promise-reject-errors': 'error',

  'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],

  complexity: ['error', { max: 15 }],
  'max-depth': ['error', { max: 4 }],
  'max-params': ['error', { max: 4 }],
  'no-await-in-loop': 'error',
  'max-nested-callbacks': ['error', { max: 4 }],

  'sonarjs/cognitive-complexity': ['error', 15],
  'sonarjs/no-duplicate-string': 'off',
  'sonarjs/no-nested-conditional': 'error',
  'sonarjs/prefer-single-boolean-return': 'error',
  'sonarjs/prefer-regexp-exec': 'error',
  'sonarjs/no-empty-collection': 'error',
  'sonarjs/reduce-initial-value': 'error',
  'sonarjs/no-redundant-optional': 'error',
};

const transportFreeFiles = [
  'src/config/**/*.ts',
  'src/domain/**/*.ts',
  'src/lib/**/*.ts',
  'src/core/**/*.ts',
  'src/infra/db/**/*.ts',
  'src/infra/redmine/**/*.ts',
  'src/infra/tmdb/**/*.ts',
  'src/infra/crypto/**/*.ts',
  'src/infra/logging/**/*.ts',
  'src/infra/scheduler/**/*.ts',
  'src/infra/web/**/*.{ts,tsx}',
  'src/features/*/service.ts',
  'src/features/*/schema.ts',
];

const noDiscordImport = {
  name: 'discord.js',
  message: 'Only the Discord adapter may use discord.js.',
};

const modulePatterns = [
  {
    regex: '^~/(config|domain/[a-z-]+|lib|core/[a-z-]+|infra/[a-z-]+)/',
    message: 'Import from the module barrel, not a file inside it.',
  },
  {
    regex: String.raw`^(\.\./)+(config|domain|lib|core|infra|features|app)(/|$)`,
    message: 'Import other modules through their ~/ barrel.',
  },
];

const unicornRules: Linter.RulesRecord = {
  'unicorn/prefer-set-has': 'error',
  'unicorn/prefer-array-some': 'error',
  'unicorn/prefer-array-find': 'error',
  'unicorn/prefer-array-flat': 'error',
  'unicorn/prefer-array-flat-map': 'error',
  'unicorn/prefer-array-index-of': 'error',
  'unicorn/prefer-includes': 'error',
  'unicorn/prefer-string-starts-ends-with': 'error',
  'unicorn/prefer-string-slice': 'error',
  'unicorn/prefer-string-replace-all': 'error',
  'unicorn/prefer-string-raw': 'error',
  'unicorn/prefer-number-properties': 'error',
  'unicorn/prefer-regexp-test': 'error',
  'unicorn/prefer-type-error': 'error',
  'unicorn/prefer-date-now': 'error',
  'unicorn/prefer-at': 'error',

  'unicorn/no-useless-switch-case': 'error',
  'unicorn/no-useless-promise-resolve-reject': 'error',
  'unicorn/no-useless-spread': 'error',
  'unicorn/no-useless-length-check': 'error',
  'unicorn/no-unnecessary-await': 'error',
  'unicorn/no-useless-undefined': 'error',
  'unicorn/no-await-expression-member': 'error',
  'unicorn/no-for-loop': 'error',

  'unicorn/no-array-reduce': 'off',
  'unicorn/no-array-callback-reference': 'error',
};

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/.output/**',
    '**/.cache/**',
    '**/.turbo/**',
    '**/.vercel/**',
    '**/vendor/**',
    '**/generated/**',
    '**/*.generated.*',
    '**/*.min.js',
    '**/*.d.ts',
  ]),

  {
    files: sourceFiles,
    extends: [js.configs.recommended, sonarConfigs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.builtin,
    },
    rules: qualityRules,
  },

  {
    files: sourceFiles,
    plugins: { unicorn },
    rules: unicornRules,
  },

  {
    files: ['**/*.tsx'],
    plugins: { react },
    settings: { react: { version: '19' } },
    rules: {
      'react/jsx-key': ['error', { checkFragmentShorthand: true }],
      'react/no-array-index-key': 'error',
      'react/button-has-type': 'error',
    },
  },

  {
    files: javascriptFiles,
    languageOptions: {
      sourceType: 'module',
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },

  {
    files: typescriptFiles,
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-shadow': 'off',
      'default-param-last': 'off',
      'no-redeclare': 'off',

      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/default-param-last': 'error',
      '@typescript-eslint/no-redeclare': 'error',

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',

      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-generic-constructors': [
        'error',
        'constructor',
      ],
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/method-signature-style': ['error', 'property'],

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: true,
        },
      ],

      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true },
      ],

      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: true },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-type-parameters': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/prefer-reduce-type-parameter': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/only-throw-error': 'error',
    },
  },

  {
    files: [
      '**/*.{test,spec}.{js,jsx,ts,tsx}',
      '**/__tests__/**/*.{js,jsx,ts,tsx}',
    ],
    rules: {
      'max-params': 'off',
      'sonarjs/no-duplicate-string': 'off',
    },
  },

  {
    files: [
      '**/*.config.{js,mjs,cjs,ts,mts,cts}',
      '**/scripts/**/*.{js,mjs,cjs,ts,mts,cts}',
    ],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: [
      'src/**/*.{ts,tsx}',
      'tests/**/*.ts',
      'scripts/**/*.ts',
      '*.config.ts',
    ],
    languageOptions: {
      globals: globals.node,
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      'import-x/no-cycle': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            'tests/**',
            'scripts/**',
            '**/*.test.ts',
            '*.config.ts',
          ],
        },
      ],
      'import-x/no-duplicates': 'error',
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/domain',
              from: [
                './src/core',
                './src/infra',
                './src/config',
                './src/features',
                './src/app.ts',
              ],
              message: 'The domain depends on nothing but itself and lib.',
            },
            {
              target: './src/core',
              from: ['./src/infra', './src/features', './src/app.ts'],
              message: 'Ports and services must not know their adapters.',
            },
            {
              target: './src/lib',
              from: [
                './src/domain',
                './src/core',
                './src/infra',
                './src/config',
                './src/features',
                './src/app.ts',
              ],
              message: 'lib is generic and depends on nothing in the app.',
            },
            {
              target: ['./src/infra', './src/features'],
              from: ['./src/app.ts', './src/index.ts'],
              message: 'Adapters must not import the composition root.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: modulePatterns }],
    },
  },

  {
    files: transportFreeFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [noDiscordImport], patterns: modulePatterns },
      ],
    },
  },

  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/no-await-expression-member': 'off',
      'no-restricted-imports': 'off',
      'no-await-in-loop': 'off',
    },
  },

  {
    files: ['src/lib/async.ts', 'src/infra/scheduler/runner.ts'],
    rules: { 'no-await-in-loop': 'off' },
  },

  prettier,

  {
    files: typescriptFiles,
    rules: {
      curly: ['error', 'all'],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportDeclaration[source.value=/^\\.{1,2}\\/.*\\.js$/], ImportExpression[source.value=/^\\.{1,2}\\/.*\\.js$/]',
          message: 'Import local modules without the .js extension.',
        },
      ],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: ['const', 'let'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
        { blankLine: 'always', prev: 'block-like', next: '*' },
      ],
    },
  },
);
