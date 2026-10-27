import { randomBytes, timingSafeEqual } from 'node:crypto';

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sendForbidden(response, code, message) {
  response.status(403).json({ error: { code, message } });
}

export function createCsrfMiddleware(clientOrigin) {
  return (request, response, next) => {
    if (!unsafeMethods.has(request.method)) return next();

    const requestOrigin = request.get('origin');
    let normalizedOrigin;
    try {
      normalizedOrigin = requestOrigin ? new URL(requestOrigin).origin : null;
    } catch {
      normalizedOrigin = null;
    }
    if (normalizedOrigin !== clientOrigin) {
      return sendForbidden(response, 'INVALID_ORIGIN', 'The request origin is not allowed.');
    }

    const suppliedToken = request.get('x-csrf-token');
    const expectedToken = request.session?.csrfToken;
    if (!suppliedToken || !expectedToken) {
      return sendForbidden(response, 'CSRF_TOKEN_REQUIRED', 'A valid CSRF token is required.');
    }

    const suppliedBytes = Buffer.from(suppliedToken);
    const expectedBytes = Buffer.from(expectedToken);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      return sendForbidden(response, 'INVALID_CSRF_TOKEN', 'A valid CSRF token is required.');
    }

    return next();
  };
}

export function newCsrfToken() {
  return randomBytes(32).toString('base64url');
}