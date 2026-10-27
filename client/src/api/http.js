export async function requestJson(path, { method = 'GET', body, signal, csrfToken } = {}) {
  const headers = { Accept: 'application/json' };
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  let token = csrfToken;
  if (mutating && !token) {
    const csrf = await requestJson('/auth/csrf', { method: 'GET', signal });
    token = csrf.csrfToken;
  }
  if (mutating) headers['X-CSRF-Token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? 'The request failed.');
    error.status = response.status;
    error.code = payload?.error?.code ?? 'REQUEST_FAILED';
    error.details = payload?.error?.details;
    throw error;
  }

  return payload?.data;
}

export function getJson(path, options = {}) {
  return requestJson(path, { ...options, method: 'GET' });
}