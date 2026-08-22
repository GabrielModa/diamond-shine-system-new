import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

export default defineConfig([
  ...nextVitals,
  {
    // React Compiler is not enabled. These compiler-compatibility rules reject
    // intentional hydration, polling, and dialog-reset effects used by the app.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'playwright-report/**',
    'test-results/**',
    'apps/mobile/**',
  ]),
])
