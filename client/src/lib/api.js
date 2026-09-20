const BASE_URL_KEY = 'taza_api_base_url';

export function getApiBase() {
  return localStorage.getItem(BASE_URL_KEY) || import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:4000`;
}

export function setApiBase(url) {
  localStorage.setItem(BASE_URL_KEY, url.replace(/\/$/, ''));
}

async function request(path, options = {}) {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  upload: async (path, file, extraFields = {}) => {
    const form = new FormData();
    form.append('file', file);
    for (const [key, value] of Object.entries(extraFields)) form.append(key, value);
    const res = await fetch(`${getApiBase()}${path}`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed: ${res.status}`);
    return data;
  },
};
