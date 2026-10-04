import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, chmodSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { assertPanelCompression } from './wsx-r05-panel-oracle.mjs';

const referenceHead = 'd1df49f490d9721d313fd0bc751b2a0f23e190b2';
const panelPath = 'apps/web/components/whiteboard/board-draw-tool-panel.tsx';
const choices = ['pen', 'marker', 'pencil', 'highlighter', 'eraser'];
const bodyClasses = 'font-variables font-sans antialiased';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const args = Object.fromEntries(process.argv.slice(2).reduce((entries, value, index, all) => {
  if (index % 2 === 0) entries.push([value.replace(/^--/, ''), all[index + 1]]);
  return entries;
}, []));
let browser, compiler, out, outputReady = false, failure, phase = 'PREFLIGHT';
const originalLoaders = new Map();
const inputs = new Map();
const runnerPath = fileURLToPath(import.meta.url);
function source(path) {
  const bytes = readFileSync(path);
  const sha256 = digest(bytes);
  if (inputs.has(path)) assert.equal(inputs.get(path), sha256, 'Input changed during preparation');
  else inputs.set(path, sha256);
  return bytes;
}
function git(root, ...parameters) {
  return execFileSync('git', parameters, { cwd: root, encoding: 'utf8' }).trim();
}
function freshOutput(path) {
  const parent = dirname(path), boundary = realpathSync(tmpdir());
  assert.equal(realpathSync(parent), parent, 'Output parent must be physical');
  let ancestor = parent;
  while (ancestor !== boundary) {
    const part = lstatSync(ancestor);
    assert(part.isDirectory() && !part.isSymbolicLink());
    assert.equal(part.uid, process.getuid());
    assert.equal(part.mode & 0o777, 0o700);
    const next = dirname(ancestor);
    assert.notEqual(next, ancestor, 'Output must be inside the physical temporary boundary');
    ancestor = next;
  }
  mkdirSync(path, { mode: 0o700 });
}
function privateJson(name, value) {
  writeFileSync(resolve(out, name), JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
}
try {
  assert(args.root && args.out && /^[a-f0-9]{40}$/.test(args['source-sha']));
  const root = realpathSync(args.root), candidateHead = args['source-sha'];
  assert.equal(git(root, 'rev-parse', 'HEAD'), candidateHead);
  assert.equal(git(root, 'status', '--porcelain'), '');
  out = resolve(args.out); freshOutput(out); outputReady = true;
  source(runnerPath); source(resolve(dirname(runnerPath), 'wsx-r05-panel-oracle.mjs'));
  const web = resolve(root, 'apps/web');
  const require = createRequire(resolve(web, 'package.json'));
  const rootRequire = createRequire(resolve(root, 'package.json'));
  const tsxPackage = rootRequire.resolve('tsx/package.json');
  source(tsxPackage);
  const compilerRequire = createRequire(tsxPackage);
  // Bind actual CommonJS transitive input bytes before each module is evaluated.
  for (const extension of ['.js', '.json', '.node']) {
    const original = Module._extensions[extension];
    if (!original) continue;
    originalLoaders.set(extension, original);
    Module._extensions[extension] = function captureInput(module, filename) {
      source(filename);
      return original(module, filename);
    };
  }
  for (const dependency of ['postcss', 'tailwindcss', 'tailwindcss/loadConfig', 'autoprefixer', 'react', 'react-dom/server', 'lucide-react', '@playwright/test']) source(require.resolve(dependency));
  source(compilerRequire.resolve('esbuild'));
  const esbuild = compiler = compilerRequire('esbuild'), postcss = require('postcss');
  source(createRequire(compilerRequire.resolve('esbuild')).resolve(`@esbuild/${process.platform}-${process.arch}/bin/esbuild`));
  assert.equal(process.env.ESBUILD_BINARY_PATH, undefined, 'Do not use an unbound alternate compiler binary');
  const tailwind = require('tailwindcss'), loadConfig = require('tailwindcss/loadConfig');
  const autoprefixer = require('autoprefixer');
  const oldBytes = execFileSync('git', ['show', `${referenceHead}:${panelPath}`], { cwd: root });
  const currentBytes = source(resolve(root, panelPath));
  assert.notEqual(digest(oldBytes), digest(currentBytes));
  phase = 'RENDER_INPUTS';
  async function markup(panelBytes) {
    const bundle = await esbuild.build({
      stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {BoardDrawToolPanel} from './components/whiteboard/board-draw-tool-panel'; export function render(choice){return renderToStaticMarkup(React.createElement(BoardDrawToolPanel,{choice,appearance:{width:8,opacity:.35,color:'#FACC15'},readOnly:false,onChoiceChange(){},onAppearanceChange(){},onSelect(){},onClose(){}}));}`,
        resolveDir: web, loader: 'tsx' },
      absWorkingDir: web, bundle: true, write: false, platform: 'node', format: 'cjs',
      packages: 'external', jsx: 'automatic', metafile: true,
      plugins: [{ name: 'exact-reference-panel', setup(build) {
        build.onLoad({ filter: /board-draw-tool-panel\.tsx$/ }, () => ({ contents: panelBytes.toString('utf8'), loader: 'tsx', resolveDir: dirname(resolve(root, panelPath)) }));
        build.onLoad({ filter: /\.(ts|tsx)$/ }, ({ path }) => ({ contents: source(path).toString('utf8'), loader: path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(path) }));
      } }],
    });
    for (const input of Object.keys(bundle.metafile.inputs)) {
      if (input !== '<stdin>' && !input.endsWith('board-draw-tool-panel.tsx')) source(resolve(web, input));
    }
    const module = { exports: {} };
    runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, process, console });
    return Object.fromEntries(choices.map(choice => [choice, module.exports.render(choice)]));
  }
  const beforeMarkup = await markup(oldBytes), afterMarkup = await markup(currentBytes);
  const configPath = resolve(web, 'tailwind.config.ts'); source(configPath);
  source(resolve(web, 'lib/font-scale.ts'));
  const globals = source(resolve(web, 'app/globals.css'));
  const fontVariables = source(resolve(web, 'app/fonts.module.css'));
  const config = loadConfig(configPath);
  // Compile one stylesheet with both real component class sets, never estimated layout CSS.
  config.content = [{ raw: oldBytes.toString() + currentBytes.toString(), extension: 'tsx' },
    { raw: `<body class="${bodyClasses}">${Object.values(beforeMarkup).join('\n')}${Object.values(afterMarkup).join('\n')}</body>`, extension: 'html' }];
  const compiled = await postcss([tailwind(config), autoprefixer]).process(globals.toString(), { from: resolve(web, 'app/globals.css') });
  let fontCss = '';
  for (const family of ['noto-sans-sc', 'jetbrains-mono', 'bitter']) {
    const path = require.resolve(`@fontsource-variable/${family}/index.css`);
    const css = source(path).toString();
    fontCss += css.replace(/url\(([^)]+)\)/g, (_, value) => {
      const asset = resolve(dirname(path), value.replace(/['"]/g, ''));
      return `url(data:font/woff2;base64,${source(asset).toString('base64')})`;
    });
  }
  const css = fontCss + '\n' + fontVariables.toString().replace(/\.variables/g, '.font-variables') + '\n' + compiled.css;
  const cssSha256 = digest(css);
  const { chromium } = require('@playwright/test');
  for (const module of Object.values(require.cache)) if (module?.filename) source(module.filename);
  phase = 'BROWSER_CAPTURE'; browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  const samples = [], comparisons = [], failures = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const choice of choices) {
      const pair = {};
      for (const [kind, html, head] of [['before', beforeMarkup[choice], referenceHead], ['after', afterMarkup[choice], candidateHead]]) {
        await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head><body class="${bodyClasses}"><main style="position:relative;width:100vw;height:100vh">${html}</main></body></html>`);
        const measurement = await page.evaluate(async () => {
          await document.fonts.ready;
          await document.fonts.load('16px "Noto Sans SC Variable"', '绘制工具');
          await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
          const panel = document.querySelector('[data-testid="board-draw-tool-panel"]');
          const box = panel.getBoundingClientRect();
          return { box: { x: box.x, y: box.y, width: box.width, height: box.height },
            fontFamily: getComputedStyle(panel).fontFamily,
            fontVariable: getComputedStyle(panel).getPropertyValue('--font-sans').trim(),
            fontsReady: document.fonts.status === 'loaded' && document.fonts.check('16px "Noto Sans SC Variable"', '绘制工具'),
            viewport: { width: innerWidth, height: innerHeight }, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.equal(measurement.horizontalOverflow, false);
        assert.equal(measurement.fontsReady, true);
        assert.equal(measurement.fontVariable, '"Noto Sans SC Variable"');
        assert.equal(measurement.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, ''), 'Noto Sans SC Variable');
        const filename = `${kind}-${choice}-${width}.png`;
        const png = await page.screenshot({ path: resolve(out, filename), fullPage: true });
        chmodSync(resolve(out, filename), 0o600);
        pair[kind] = { ...measurement, choice, sourceHead: head, cssSha256, screenshot: filename, screenshotSha256: digest(png) };
        if (kind === 'before') samples.push(pair[kind]);
      }
      try { comparisons.push({ width, choice, ...assertPanelCompression(pair), before: pair.before, after: pair.after }); }
      catch { failures.push({ width, choice, category: 'PANEL_COMPRESSION_CONTRACT_FAILED', before: pair.before, after: pair.after }); }
    }
  }
  phase = 'END_SOURCE';
  for (const [path, sha256] of inputs) assert.equal(digest(readFileSync(path)), sha256, 'Input drift');
  assert.equal(git(root, 'rev-parse', 'HEAD'), candidateHead);
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.equal(digest(execFileSync('git', ['show', `${referenceHead}:${panelPath}`], { cwd: root })), digest(oldBytes));
  const inputHashes = [...inputs].map(([path, sha256]) => ({ path: relative(root, path), sha256 }));
  privateJson('panel-baseline.json', { sourceHead: referenceHead, capturedFromBrowser: true, samples,
    sourceContext: 'old-git-component-with-candidate-shared-css-fonts-and-dependencies-not-old-production-runtime',
    candidateHead, referencePanelSha256: digest(oldBytes), candidatePanelSha256: digest(currentBytes), cssSha256, inputHashes });
  privateJson('panel-reference-result.json', { candidateHead, referenceHead, cssSha256, comparisons, failures,
    componentReferenceCapture: true, productionBoardAcceptance: false, requiredSuiteComplete: false });
  assert.equal(failures.length, 0, 'Panel compression contract failed; keep actual measurements');
} catch (error) {
  failure = error;
  if (outputReady) {
    try { privateJson('reference-failure.json', { status: 'failed', phase, reason: 'REFERENCE_CAPTURE_FAILED', requiredSuiteComplete: false }); }
    catch (receiptError) { failure = new AggregateError([failure, receiptError], 'Reference capture and safe receipt failed'); }
  }
} finally {
  for (const [extension, original] of originalLoaders) Module._extensions[extension] = original;
  try { await browser?.close(); }
  catch (error) { failure = failure ? new AggregateError([failure, error], 'Reference capture and cleanup failed') : error; }
  try { compiler?.stop(); }
  catch (error) { failure = failure ? new AggregateError([failure, error], 'Reference capture and compiler cleanup failed') : error; }
}
if (failure) { console.error('REFERENCE_CAPTURE_FAILED'); process.exitCode = 1; }
