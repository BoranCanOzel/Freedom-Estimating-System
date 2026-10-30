import { build } from 'esbuild';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { brotliCompressSync, gzipSync } from 'node:zlib';

await build({entryPoints:['client/app.js','client/shared-view.js'],bundle:true,format:'iife',loader:{'.png':'file'},external:['/assets/pdf-renderer.js'],publicPath:'/assets',outdir:'dist'});
// Load the PDF engine and its embedded fonts only when an export is requested.
await build({entryPoints:['client/pdf-renderer.js'],bundle:true,format:'esm',loader:{'.ttf':'binary'},outfile:'dist/pdf-renderer.js'});
// Compress once at build time; requests can reuse bytes without blocking Node.
const files=(await readdir('dist')).filter(name=>/\.(js|css)$/.test(name)).map(name=>['dist/'+name,'dist/'+name]);
files.push(['index.html','dist/index.html']);
await Promise.all(files.map(async([source,target])=>{
  const bytes=await readFile(source);
  await Promise.all([writeFile(target+'.br',brotliCompressSync(bytes)),writeFile(target+'.gz',gzipSync(bytes))]);
}));
