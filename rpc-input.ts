/** Drop keys whose value is `undefined`. BB plugin RPC is JSON; `undefined` is not. */
export function omitUndefined<T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as { [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined> };
}
