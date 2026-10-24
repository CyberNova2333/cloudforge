// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
export const encoder = new TextEncoder();
/** For showing text: invalid bytes become U+FFFD and a BOM is dropped. Never decode with it what is written back. */
export const decoder = new TextDecoder();

/** Strict UTF-8 that keeps a BOM (as U+FEFF): encoding the result gives back exactly the same bytes. */
const exactDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** `bytes` as UTF-8 text that encodes back to the same bytes, or null when they aren't valid UTF-8. */
export function exactUtf8(bytes: Uint8Array): string | null {
  try {
    return exactDecoder.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * `bytes` as a string of one character per byte (U+0000–U+00FF), for line-wise work on text in another encoding
 * (GBK, Shift-JIS, Latin-1, …): those keep LF as the byte 0x0A, and `fromBinaryString` gives back the same bytes.
 */
export function toBinaryString(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

export function fromBinaryString(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha1(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-1', data));
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
  );
}

export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
