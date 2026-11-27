export const STUDIO_RATE_LIMIT_CODE = -32029;

const numericFields = [
  ['retry_after_seconds', 'retryAfterSeconds'],
  ['limit', 'limit'],
  ['current', 'current'],
];

export function rpcRateLimit(error) {
  let info = null;
  // SDK wrappers may preserve the code only in the original cause.
  for (let depth = 0; depth < 8 && error && typeof error === 'object'; depth++, error = error.cause) {
    if (error.code !== STUDIO_RATE_LIMIT_CODE) continue;
    info ??= {};
    const data = error.data;
    for (const [field, key] of numericFields) {
      const value = data?.[field];
      if (Number.isSafeInteger(value) && value >= 0) info[key] ??= value;
    }
    if (data?.bucket === 'standard') info.bucket = 'standard';
    if (data?.window === 'hour') info.window = 'hour';
  }
  return info;
}
