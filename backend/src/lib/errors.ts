export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details: unknown = null,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFound(label: string): AppError {
  return new AppError('NOT_FOUND', `${label} was not found.`, 404);
}

export function conflict(message: string, details?: unknown): AppError {
  return new AppError('CONFLICT', message, 409, details ?? null);
}

export function validation(message: string, details?: unknown): AppError {
  return new AppError('VALIDATION_ERROR', message, 400, details ?? null);
}

export function forbidden(message = 'You do not have permission to do that.'): AppError {
  return new AppError('FORBIDDEN', message, 403);
}
