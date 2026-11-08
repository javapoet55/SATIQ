import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('./landing',import.meta.url)),
  base:'/landing/',
  build:{outDir:fileURLToPath(new URL('./dist/landing',import.meta.url)),emptyOutDir:true},
});
