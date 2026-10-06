export function multipart(payload, name = 'proof.txt', mime = 'text/plain', preserveOriginalName = false) {
  const body = new FormData();
  body.append('file', new Blob([payload], {type: mime}), name);
  if (preserveOriginalName) body.append('fileName', name);
  return body;
}
