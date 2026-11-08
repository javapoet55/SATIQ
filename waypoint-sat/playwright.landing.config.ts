import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/landing',workers:1,timeout:30000,
  use:{baseURL:'http://127.0.0.1:5192',channel:'chrome',headless:true,reducedMotion:'reduce'},
  outputDir:'test-results/landing',
  webServer:{command:'node --experimental-strip-types tests/landing-preview.mjs',url:'http://127.0.0.1:5192',reuseExistingServer:false},
});
