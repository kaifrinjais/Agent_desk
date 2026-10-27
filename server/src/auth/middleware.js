export function requireAuth(database) {
  return async (request, response, next) => {
    if (!Number.isSafeInteger(request.session?.userId)) {
      return response.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' },
      });
    }

    try {
      const row = await database.get(
        `SELECT id, full_name AS fullName, email, role, client_id AS clientId,
                must_change_password AS mustChangePassword
         FROM users WHERE id = ? AND is_active = 1;`,
        request.session.userId,
      );
      if (!row) {
        return request.session.destroy(() => {
          response.clearCookie('agencydesk.sid', { path: '/' });
          response.status(401).json({
            error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' },
          });
        });
      }

      request.authUser = {
        ...row,
        mustChangePassword: row.mustChangePassword === 1,
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requirePasswordChanged(request, response, next) {
  if (request.authUser.mustChangePassword) {
    return response.status(403).json({
      error: {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Change your temporary password before continuing.',
      },
    });
  }
  return next();
}

export function requireRole(...roles) {
  return (request, response, next) => {
    if (!roles.includes(request.authUser.role)) {
      return response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' },
      });
    }
    return next();
  };
}