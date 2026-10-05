export function connectorLoginDiagnostic(status, body, expectedUserId, expectedToken, jsonParsed) {
  const candidate = jsonParsed === true && body !== null && typeof body === 'object' && !Array.isArray(body);
  const descriptors = candidate ? Object.getOwnPropertyDescriptors(body) : {};
  const actor = descriptors.userId, token = descriptors.sessionToken;
  const dataFields = Boolean(actor && token && Object.hasOwn(actor,'value') && Object.hasOwn(token,'value'));
  const object = candidate && dataFields;
  const actorValue = object ? actor.value : undefined, tokenValue = object ? token.value : undefined;
  const actorPresent = object && typeof actorValue === 'string' && actorValue.length > 0;
  const tokenPresent = object && typeof tokenValue === 'string' && tokenValue.length > 0;
  return {version:1,httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:null,
    jsonParsed:jsonParsed===true,objectSchema:object,actorString:actorPresent,tokenString:tokenPresent,
    actorMatches:actorPresent&&actorValue===expectedUserId,tokenMatches:tokenPresent&&tokenValue===expectedToken};
}
