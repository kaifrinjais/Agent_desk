export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound() {
  return new AppError(404, 'NOT_FOUND', 'The requested resource was not found.');
}

export function validationError(error) {
  return new AppError(
    400,
    'VALIDATION_ERROR',
    'The request contains invalid fields.',
    error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
  );
}

export function requireValid(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}