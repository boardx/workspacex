import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(createRequire(import.meta.url).resolve('vitest/package.json')); 
const {createServer}=require('vite');
const web=resolve(import.meta.dirname,'../..');
const appRequire=createRequire(resolve(web,'package.json'));
const tailwind=appRequire('tailwindcss'),autoprefixer=appRequire('autoprefixer');
const server=await createServer({define:{'process.env.NEXT_PUBLIC_API_URL':JSON.stringify('http://127.0.0.1:33755'),'process.env':JSON.stringify({})},publicDir:resolve(web,'public'),root:import.meta.dirname,configFile:false,resolve:{alias:{'@':web}},esbuild:{jsx:'automatic'},css:{postcss:{plugins:[tailwind({config:resolve(web,'tailwind.config.ts')}),autoprefixer()]}},server:{host:'127.0.0.1',port:33755,strictPort:true,fs:{allow:[resolve(web,'../..')]}}});
await server.listen();server.printUrls();
