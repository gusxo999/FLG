/**
 * Blueprint codec: import/export Factorio blueprint strings.
 *
 * Factorio blueprint string format:
 *   1. JSON-encode the BlueprintWrapper object
 *   2. Compress with zlib deflate (pako)
 *   3. Base64-encode the compressed bytes
 *   4. Prepend the version byte '0'
 *
 * Import is the exact reverse.
 */

import pako from 'pako';
import type { BlueprintWrapper } from '../types/blueprint';

/** The version prefix byte that Factorio prepends to all blueprint strings */
const FACTORIO_VERSION_PREFIX = '0';

/**
 * Serialise a BlueprintWrapper to a Factorio-compatible blueprint string.
 * @throws Error if serialisation or compression fails
 */
export function exportBlueprint(data: BlueprintWrapper): string {
  const json = JSON.stringify(data);
  const utf8Bytes = new TextEncoder().encode(json);
  const compressed = pako.deflate(utf8Bytes, { level: 9 });
  const base64 = uint8ArrayToBase64(compressed);
  return FACTORIO_VERSION_PREFIX + base64;
}

/**
 * Parse a Factorio blueprint string back into a BlueprintWrapper.
 * @throws Error if the string is malformed or decompression fails
 */
export function importBlueprint(str: string): BlueprintWrapper {
  if (typeof str !== 'string' || str.length < 2) {
    throw new Error('Invalid blueprint string: too short');
  }

  // Try with the standard '0' prefix first, then fall back to the raw string
  const candidates = str[0] === FACTORIO_VERSION_PREFIX
    ? [str.slice(1), str]
    : [str, str.slice(1)];

  let compressed: Uint8Array | null = null;
  for (const candidate of candidates) {
    try {
      compressed = base64ToUint8Array(candidate);
      break;
    } catch {
      // try next candidate
    }
  }
  if (!compressed) {
    throw new Error('Blueprint string contains invalid base64 data');
  }

  let decompressed: Uint8Array;
  try {
    decompressed = pako.inflate(compressed!);
  } catch (e) {
    throw new Error(`Failed to decompress blueprint: ${(e as Error).message}`);
  }

  const json = new TextDecoder('utf-8').decode(decompressed);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Blueprint contains invalid JSON after decompression');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Blueprint JSON root must be an object');
  }

  const wrapper = parsed as BlueprintWrapper;

  if (!wrapper.blueprint && !wrapper['blueprint-book']) {
    throw new Error(
      'Blueprint JSON must contain a "blueprint" or "blueprint-book" key'
    );
  }

  return wrapper;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Use btoa with a chunked approach to avoid call-stack overflows on large arrays
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
