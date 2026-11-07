import {defineConfig} from '@playwright/test';
// Full-stack sign-in tests: real Node server + PostgreSQL. Requires DATABASE_URL to point at a disposable database.
export default defineConfig({testDir:'./tests/auth', timeout:45000, workers:1,
  use:{baseURL:'http://127.0.0.1:5193', channel:'chrome', headless:true, reducedMotion:'reduce', trace:'retain-on-failure'},
  outputDir:'test-results-auth',
  webServer:{command:'VITE_PERSISTENCE_MODE=server npm run build && node --experimental-strip-types server/index.mjs', env:{PORT:'5193', NODE_ENV:'development'}, url:'http://127.0.0.1:5193/api/health', reuseExistingServer:false, timeout:120000},
});
