import {defineConfig} from 'vitest/config'; import react from '@vitejs/plugin-react'; import {viteSingleFile} from 'vite-plugin-singlefile';
export default defineConfig({base:'./',plugins:[react(),viteSingleFile()],build:{sourcemap:false},test:{environment:'jsdom',setupFiles:['./tests/setup.ts']}});
