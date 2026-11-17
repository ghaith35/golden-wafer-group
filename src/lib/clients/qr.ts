const CLIENT_CODE = /^CLT-[A-Z0-9-]+$/;
const CLIENT_QR = /^DCLT:\/\/([^/]+)\/(CLT-[A-Z0-9-]+)$/i;

export function parseClientScan(text: string, companyId: string) {
  const value = text.trim();
  if (CLIENT_CODE.test(value)) return { code: value };
  if (/^DCLT:\/\//i.test(value)) {
    const native = CLIENT_QR.exec(value);
    return native && native[1] === companyId ? { code: native[2] } : null;
  }
  return isLegacyClientQr(value) ? { legacyQr: value } : null;
}

export function isLegacyClientQr(text: string) {
  return text.length > 0 && new TextEncoder().encode(text).length <= 2048 &&
    !text.includes("\0") && !CLIENT_CODE.test(text) && !/^DCLT:\/\//i.test(text);
}
