import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './testy/e2e',
  timeout: 45_000,
  fullyParallel: true,
  reporter: [['list'], ['json', { outputFile: 'wyniki-e2e.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
    // Telefon zblizony do docelowego: maly ekran, dotyk.
    ...devices['Pixel 5'],
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
