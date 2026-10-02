/** Token-bound browser compatibility storage. Plain data keys never leave WebCrypto. */
export type WhiteboardKeyEnvelope = {
  version: 1; boardId: string; keyId: string; generation: string;
  salt: ArrayBuffer; iv: ArrayBuffer; ciphertext: ArrayBuffer;
};
const bytes = (value: string) => new TextEncoder().encode(value);
const domain = (envelope: Pick<WhiteboardKeyEnvelope, 'boardId'|'keyId'|'generation'>) =>
  JSON.stringify(['workspacex.whiteboard.outbox.key-envelope', 1, envelope.boardId, envelope.keyId, envelope.generation]);
export function validateWhiteboardKeyEnvelope(envelope: WhiteboardKeyEnvelope) {
  if (envelope.version !== 1 || typeof envelope.boardId !== 'string' || !envelope.boardId || typeof envelope.keyId !== 'string' || !envelope.keyId || !/^[a-f0-9]{64}$/.test(envelope.generation)
    || !(envelope.salt instanceof ArrayBuffer) || envelope.salt.byteLength !== 32
    || !(envelope.iv instanceof ArrayBuffer) || envelope.iv.byteLength !== 12
    || !(envelope.ciphertext instanceof ArrayBuffer) || envelope.ciphertext.byteLength !== 48) throw new Error('OUTBOX_KEY_ENVELOPE_INVALID');
}
async function wrappingKey(token: string, envelope: WhiteboardKeyEnvelope) {
  if (!token) throw new Error('OUTBOX_KEY_TOKEN_REQUIRED');
  const material = await crypto.subtle.importKey('raw', bytes(token), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:envelope.salt,info:bytes(domain(envelope))}, material,
    {name:'AES-GCM',length:256},false,['wrapKey','unwrapKey']);
}
export async function wrapWhiteboardKey(key: CryptoKey, token: string,
  context: Pick<WhiteboardKeyEnvelope, 'boardId'|'keyId'|'generation'>): Promise<WhiteboardKeyEnvelope> {
  const envelope: WhiteboardKeyEnvelope = {...context,version:1,salt:crypto.getRandomValues(new Uint8Array(32)).buffer,
    iv:crypto.getRandomValues(new Uint8Array(12)).buffer,ciphertext:new ArrayBuffer(48)};
  validateWhiteboardKeyEnvelope(envelope);
  envelope.ciphertext = await crypto.subtle.wrapKey('raw',key,await wrappingKey(token,envelope),
    {name:'AES-GCM',iv:envelope.iv,additionalData:bytes(domain(envelope))});
  return envelope;
}
async function unwrap(envelope: WhiteboardKeyEnvelope, token: string, extractable: boolean) {
  validateWhiteboardKeyEnvelope(envelope);
  return crypto.subtle.unwrapKey('raw',envelope.ciphertext,await wrappingKey(token,envelope),
    {name:'AES-GCM',iv:envelope.iv,additionalData:bytes(domain(envelope))},
    {name:'AES-GCM',length:256},extractable,['encrypt','decrypt']);
}
export async function unwrapWhiteboardKey(envelope: WhiteboardKeyEnvelope, token: string,
  expected: Pick<WhiteboardKeyEnvelope, 'boardId'|'keyId'|'generation'>) {
  if (envelope.boardId !== expected.boardId || envelope.keyId !== expected.keyId || envelope.generation !== expected.generation)
    throw new Error('OUTBOX_KEY_CONTEXT_MISMATCH');
  return unwrap(envelope,token,false);
}
/** The temporary extractable handle is scoped solely to wrapping the successor. */
export async function rewrapWhiteboardKey(envelope: WhiteboardKeyEnvelope, fromToken: string, toToken: string, generation: string,
  expected: Pick<WhiteboardKeyEnvelope, 'boardId'|'keyId'|'generation'>) {
  if (envelope.boardId !== expected.boardId || envelope.keyId !== expected.keyId || envelope.generation !== expected.generation)
    throw new Error('OUTBOX_KEY_CONTEXT_MISMATCH');
  const temporary = await unwrap(envelope,fromToken,true);
  return wrapWhiteboardKey(temporary,toToken,{boardId:envelope.boardId,keyId:envelope.keyId,generation});
}
