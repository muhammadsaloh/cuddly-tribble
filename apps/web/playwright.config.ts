import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: process.env.E2E_WEB_URL || 'http://localhost:5173', ...devices['Desktop Chrome'] },
})
