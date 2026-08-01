const tseslint = require('typescript-eslint')

module.exports = tseslint.config(
  {
    ignores: ['app/**', 'dist/**', 'node_modules/**']
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'test/**/*.ts', 'test/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'prefer-const': 'off'
    }
  }
)
