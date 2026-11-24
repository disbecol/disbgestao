import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const target=path.resolve(import.meta.dirname,'../../src/puxada-app');
if(path.basename(target)!=='puxada-app'||path.basename(path.dirname(target))!=='src')throw Error('Destino de compilação inválido.');
export default defineConfig({base:'./',plugins:[react()],build:{target:'es2022',outDir:target,emptyOutDir:true,sourcemap:false},test:{environment:'node',include:['tests/**/*.test.ts'],testTimeout:15000,restoreMocks:true}});
