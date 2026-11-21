/** Observe the application's own print iframe; never synthesize report content. */
import { createHash, randomUUID } from 'node:crypto';
import { ORIGIN, ProbeFailure } from './devapp-aidt-auth-readonly.mjs';

const fail = code => { throw new ProbeFailure(code); };
const normalize = text => text.replace(/\s+/g, ' ').trim();
export function assertPrintDocument(document, { projectId, nonce, requiredTexts = [], imageHashes = [] }) {
  if (document?.nonce !== nonce || document.projectId !== projectId || document.ownerPath !== `/aidt/${projectId}` || document.frameTitle !== '研究报告 PDF' || document.beforeprintSeen !== true) fail('PRINT_DOCUMENT_SCOPE_REJECTED');
  if (typeof document.html !== 'string' || document.html.length < 100 || Buffer.byteLength(document.html) > 2097152 || typeof document.text !== 'string' || document.text.length < 10) fail('PRINT_DOCUMENT_BOUND');
  if (document.unsafeNodes !== 0 || document.unsafeAttributes !== false || document.externalStyles !== false || !Array.isArray(document.images) || document.images.length > 10) fail('PRINT_DOCUMENT_UNSAFE');
  for (const text of requiredTexts) if (!normalize(document.text).includes(normalize(text))) fail('PRINT_DOCUMENT_TEXT_MISMATCH');
  if (document.images.length !== imageHashes.length || JSON.stringify(document.images.map(image => image.sha256).sort()) !== JSON.stringify([...imageHashes].sort())) fail('PRINT_DOCUMENT_IMAGE_UNVERIFIED');
  for (const image of document.images) {
    if (!image.complete || image.width < 1 || image.height < 1 || !/^[a-f0-9]{64}$/.test(image.sha256 ?? '') || !imageHashes.includes(image.sha256)) fail('PRINT_DOCUMENT_IMAGE_UNVERIFIED');
  }
  return { htmlSha256: createHash('sha256').update(document.html).digest('hex'), textSha256: createHash('sha256').update(normalize(document.text)).digest('hex'), imageCount: document.images.length };
}

export function pdfStructure(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 512 || bytes.length > 8388608 || bytes.subarray(0, 5).toString() !== '%PDF-' || !bytes.subarray(-2048).includes(Buffer.from('%%EOF'))) fail('PRINT_PDF_BYTES_INVALID');
  const pageCount = [...bytes.toString('latin1').matchAll(/\/Type\s*\/Page(?:\s|\/|>)/g)].length;
  if (pageCount < 1 || pageCount > 60) fail('PRINT_PDF_PAGE_BOUND');
  return { pageCount, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** MutationObserver is passive: no print override, application DOM edit or state write. */
async function armObserver(page, identity) {
  await page.evaluate(identity => {
    const key = '__wsxAidtQaPrintObservation';
    window[key]?.dispose?.();
    const state = { ...identity, result: null, error: null, frame: null, active: true, beforeprintSeen: false };
    const observers = [], listeners = [];
    state.dispose = () => { state.active = false; observers.forEach(observer => observer.disconnect()); listeners.forEach(([node, listener, type = 'load']) => node.removeEventListener(type, listener)); };
    window[key] = state;
    if (location.origin !== identity.origin || location.pathname !== `/aidt/${identity.projectId}`) { state.error = 'PRINT_OWNER_SCOPE_REJECTED'; return; }
    let pending = false;
    async function snapshot(frame, doc) {
      if (!state.active || !state.beforeprintSeen || pending || state.frame !== frame || !doc?.body?.firstElementChild) return;
      const images = [...doc.images];
      if (images.some(image => !image.complete || image.naturalWidth < 1)) return;
      pending = true;
      try {
        const html = doc.documentElement.outerHTML, text = doc.body.innerText;
        const imageRows = [];
        for (const image of images) {
          const src = image.currentSrc || image.src;
          if (!src.startsWith(`blob:${identity.origin}/`) && !src.startsWith('data:image/png;base64,')) throw new Error('PRINT_IMAGE_SOURCE_REJECTED');
          const response = await fetch(src); const bytes = await response.arrayBuffer();
          if (bytes.byteLength > 262144) throw new Error('PRINT_IMAGE_BOUND');
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
          imageRows.push({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight, sha256: hash });
        }
        if (state.active) state.result = { nonce: identity.nonce, projectId: identity.projectId, ownerPath: location.pathname,
          frameTitle: frame.title, beforeprintSeen: state.beforeprintSeen, documentTitle: doc.title, html, text, images: imageRows,
          unsafeNodes: doc.querySelectorAll('script,iframe,object,embed,form,input,textarea,link,base,video,audio').length,
          unsafeAttributes: [...doc.querySelectorAll('*')].some(node => [...node.attributes].some(attribute => /^on/i.test(attribute.name))),
          externalStyles: [...doc.querySelectorAll('style,[style]')].some(node => /@import|url\s*\(/i.test(node.tagName === 'STYLE' ? node.textContent : node.getAttribute('style'))) };
      } catch { if (state.active) state.error = 'PRINT_DOCUMENT_OBSERVATION_FAILED'; }
      finally { pending = false; }
    }
    function watch() {
      for (const frame of document.querySelectorAll('iframe[title="研究报告 PDF"]')) {
        if (state.frame && state.frame !== frame) { state.error = 'PRINT_MULTIPLE_DOCUMENTS'; continue; }
        if (state.frame) continue;
        state.frame = frame;
        const doc = frame.contentDocument;
        if (!doc || frame.contentWindow?.parent !== window) { state.error = 'PRINT_FRAME_UNAVAILABLE'; continue; }
        const beforeprint = () => { state.beforeprintSeen = true; void snapshot(frame, doc); };
        frame.contentWindow.addEventListener('beforeprint', beforeprint); listeners.push([frame.contentWindow, beforeprint, 'beforeprint']);
        const observer = new MutationObserver(() => { for (const image of doc.images) { if (!listeners.some(([node]) => node === image)) { const listener = () => void snapshot(frame, doc); image.addEventListener('load', listener); listeners.push([image, listener]); } } void snapshot(frame, doc); });
        observer.observe(doc, { childList: true, subtree: true, attributes: true }); observers.push(observer);
        for (const image of doc.images) { const listener = () => void snapshot(frame, doc); image.addEventListener('load', listener); listeners.push([image, listener]); }
        void snapshot(frame, doc);
      }
    }
    const observer = new MutationObserver(watch); observer.observe(document, { childList: true, subtree: true }); observers.push(observer);
    // Existing print frames are not accepted for this new UI intent.
    if (document.querySelector('iframe[title="研究报告 PDF"]')) { state.error = 'PRINT_PREEXISTING_DOCUMENT'; return; }
  }, identity);
}

export async function captureApplicationPrint({ page, context, button, projectId, requiredTexts, imageHashes = [], assertSafe }) {
  const nonce = randomUUID(), identity = { origin: ORIGIN, projectId, nonce };
  let output;
  try {
    await armObserver(page, identity);
    await button.click();
    await page.waitForFunction(nonce => { const state = window.__wsxAidtQaPrintObservation; return state?.nonce === nonce && (state.error || state.result); }, nonce, { timeout: 30000 });
    const observed = await page.evaluate(() => { const state = window.__wsxAidtQaPrintObservation; return { error: state?.error, document: state?.result }; });
    if (observed.error) fail('PRINT_DOCUMENT_OBSERVATION_FAILED');
    const proof = assertPrintDocument(observed.document, { ...identity, requiredTexts, imageHashes });
    await assertSafe(observed.document.html); await assertSafe(observed.document.text);
    // A blank page opened by the owned page inherits its origin/storage key,
    // preserving the application's existing blob images without rewriting src.
    const [opened] = await Promise.all([
      context.waitForEvent('page', { timeout: 10000 }),
      page.evaluate(() => { window.open('about:blank', '_blank'); }),
    ]);
    output = opened;
    if (await output.opener() !== page || output.url() !== 'about:blank') fail('PRINT_OUTPUT_SCOPE_REJECTED');
    await output.setContent(observed.document.html, { waitUntil: 'load', timeout: 15000 });
    const same = await output.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
      return { html: document.documentElement.outerHTML, text: document.body.innerText, imageCount: document.images.length, imagesReady: [...document.images].every(image => image.complete && image.naturalWidth > 0) };
    });
    if (same.html !== observed.document.html || normalize(same.text) !== normalize(observed.document.text) || same.imageCount !== proof.imageCount || !same.imagesReady) fail('PRINT_CONVERSION_DOCUMENT_CHANGED');
    await assertSafe(same.text);
    const bytes = await output.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
    const structure = pdfStructure(bytes);
    return { bytes, html: observed.document.html, text: observed.document.text, metadata: { ...proof, ...structure,
      origin: 'application print iframe → QA Chromium native PDF output; no document content changes',
      applicationBeforeprintObserved: true, textMatchedBeforeConversion: true, imagesDecodedBeforeConversion: true, independentPdfGlyphValidation: 'pending artifact download and independent renderer' } };
  } finally {
    await page.evaluate(() => { window.__wsxAidtQaPrintObservation?.dispose?.(); delete window.__wsxAidtQaPrintObservation; }).catch(() => {});
    await output?.close().catch(() => {});
  }
}
