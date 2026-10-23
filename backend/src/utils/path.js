export function normalizePath(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Invalid file path');
  const raw = input.replace(/\\/g, '/').trim();
  if (raw.includes('\0') || raw.startsWith('/') || raw.includes('://')) throw new Error('Unsafe file path');
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '.' || p === '..' || p.includes('\0'))) throw new Error('Unsafe file path');
  return parts.join('/');
}

export function fileNameFromPath(path) {
  return path.split('/').pop();
}
