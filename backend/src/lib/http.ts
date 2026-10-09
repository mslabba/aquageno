import type { Response } from 'express';

function replacer(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    (value as { constructor?: { name?: string } }).constructor?.name === 'Decimal'
  ) {
    return (value as { toString(): string }).toString();
  }
  return value;
}

export function sendData(res: Response, data: unknown, meta?: unknown, status = 200): void {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify({ data, error: null, meta: meta ?? null }, replacer));
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  res.status(status).json({
    data: null,
    error: { code, message, details: details ?? null },
    meta: null,
  });
}

export function pageMeta(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}
