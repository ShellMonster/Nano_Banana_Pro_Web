import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'src/data/**',
      'src/i18n/**',
      'src/assets/**',
      'src-tauri/**',
      '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif',
      '**/*.svg', '**/*.ico', '**/*.woff', '**/*.woff2',
      '**/*.ttf', '**/*.eot',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/[\\u4E00-\\u9FFF]/]',
          message: 'Avoid hardcoded CJK text; use i18n.'
        },
        {
          selector: 'JSXText[value=/[\\u4E00-\\u9FFF]/]',
          message: 'Avoid hardcoded CJK text; use i18n.'
        },
        {
          selector: 'TemplateElement[value.raw=/[\\u4E00-\\u9FFF]/]',
          message: 'Avoid hardcoded CJK text; use i18n.'
        }
      ],
    },
  }
)
