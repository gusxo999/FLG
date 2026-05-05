/**
 * Minimal nanoid-like function for generating unique entity IDs.
 * Uses crypto.randomUUID when available (modern browsers), falls back to Math.random.
 */
export function nanoid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback
  return 'xxxx-xxxx-4xxx-yxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
