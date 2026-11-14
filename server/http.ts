export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export async function readJson<T = Record<string, unknown>>(request: Request, limit = 512 * 1024): Promise<T> {
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, 'That request is too large.');
  if (!text.trim()) return {} as T;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'The request body must be a JSON object.');
  }
  return value as T;
}

/** Postgres error codes we can explain in plain words. */
function describeDbError(error: { code?: string; message?: string }): HttpError | null {
  switch (error.code) {
    case '23503':
      return new HttpError(409, 'That teammate or entry no longer exists. Refresh and try again.');
    case '23505':
      return new HttpError(409, 'That was already saved. Refresh and try again.');
    case '23514':
    case '22P02':
    case '22007':
    case '22008':
      return new HttpError(400, 'Some of the values were not accepted. Check the form and try again.');
    default:
      return null;
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  const dbError = error && typeof error === 'object' ? describeDbError(error as { code?: string }) : null;
  if (dbError) return json({ error: dbError.message, code: dbError.code }, dbError.status);
  console.error(error);
  return json({ error: 'Something went wrong on the server. Try again.' }, 500);
}
