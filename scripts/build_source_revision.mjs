// Explicit programmatic build: no bundled config or cache written to C:.
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const arg=key=>process.argv[process.argv.indexOf(key)+1];
if(!process.argv.includes('--outDir')||!process.argv.includes('--cache-dir'))throw Error('Explicit external build/cache paths required');
await build({configFile:false,root:process.cwd(),base:'./',plugins:[react()],cacheDir:path.resolve(arg('--cache-dir')),build:{outDir:path.resolve(arg('--outDir')),assetsDir:'assets',copyPublicDir:!process.argv.includes('--client-only')}});
