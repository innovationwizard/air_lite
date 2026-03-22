/** @type {import('eslint').Linter.Config} */
const { FlatCompat } = require('@eslint/eslintrc');

const sharedRules = {
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/explicit-module-boundary-types': 'off'
};

const eslintRecommended = require('@eslint/js/src/configs/eslint-recommended.js');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: eslintRecommended
});

module.exports = [
  ...compat.extends(
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking'
  ),
  {
    files: ['src/**/*.ts'],
    ignores: ['dist/', 'node_modules/', 'migrations/'],
    languageOptions: {
    parser: require('@typescript-eslint/parser'),
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: ['./tsconfig.json']
      }
    },
    rules: sharedRules
  }
];

