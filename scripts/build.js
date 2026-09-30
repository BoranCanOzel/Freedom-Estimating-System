import { build } from 'esbuild';

await build({entryPoints:['client/app.js','client/shared-view.js'],bundle:true,format:'iife',loader:{'.png':'file'},external:['/assets/pdf-renderer.js'],publicPath:'/assets',outdir:'dist'});
// Load the PDF engine and its embedded fonts only when an export is requested.
await build({entryPoints:['client/pdf-renderer.js'],bundle:true,format:'esm',loader:{'.ttf':'binary'},outfile:'dist/pdf-renderer.js'});
