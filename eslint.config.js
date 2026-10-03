import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.d.ts', 'eslint.config.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'packages/**/*.ts'],
    plugins: { import: importPlugin },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      'import/order': ['warn', { 'newlines-between': 'never' }],
    },
  },
);
