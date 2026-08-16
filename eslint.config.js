import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.vercel/**',
      '**/.build-stubs/**',
      'packages/frontend/public/**',
      'packages/frontend/public-cloud/**',
      'packages/cloud/src/pages.generated.ts',
      'packages/frontend/vendor/**',
      // Flutter/Gradle build output (APK intermediates) — bukan kod sumber.
      'apps/android-tv/build/**',
      'apps/android-tv/.dart_tool/**',
      'apps/android-tv/android/**',
      // Output kompilasi TypeScript (dikom semula daripada .ts — jangan lint).
      'packages/shared/src/*.js',
      'packages/shared/src/*.d.ts',
      'packages/db/src/*.js',
      'packages/db/src/*.d.ts'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        queueMicrotask: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Paparan/admin guna `catch (e) {}` secara sengaja (abaikan ralat tidak
      // fatal) — padan gelagat baseline rujukan.
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  }
);
