const jsonHeaders = { 'Content-Type': 'application/json' };

export async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', ...options, headers: { ...(options.body ? jsonHeaders : {}), ...(options.headers || {}) } });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.message || payload || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
export const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = (path) => api(path, { method: 'DELETE' });
