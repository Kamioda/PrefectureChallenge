import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluglnJest from 'eslint-plugin-jest';

/** @type {import('eslint').Linter.Config[]} */
export default [
    {
        files: ['**/*.{js,mjs,cjs,ts}'],
        ignores: ['**/node_modules/**', '**/dist/**', '**/*.config.js', '!**/eslint.config.js'],
        rules: {
            'no-await-in-loop': 'error',
            'no-useless-escape': 'error',
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-alert': 'error',
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'default-case': 'error',
            'array-callback-return': 'error',
            'require-atomic-updates': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'node/no-missing-import': 'off',
            'node/no-unpublished-import': 'off',
        },
    },
    {
        languageOptions: { globals: globals.browser },
    },
    pluginJs.configs.recommended,
    eslintPluglnJest.configs.recommended,
    ...tseslint.configs.recommended,
    eslintConfigPrettier,
];
