import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/hosted', timeout:30000, workers:1,
  use:{baseURL:'http://127.0.0.1:5183', channel:'chrome', headless:true, reducedMotion:'reduce', trace:'retain-on-failure'},
  outputDir:'test-results-hosted',
  webServer:{command:'npm run dev -- --port 5183 --strictPort', env:{VITE_PERSISTENCE_MODE:'server'}, url:'http://127.0.0.1:5183', reuseExistingServer:false},
});
