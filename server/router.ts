import {
  createEntry,
  deleteEntry,
  getDay,
  getFile,
  getHistory,
  getSetup,
  runImport,
  setAttendance,
  setMark,
  submitDay,
  updateEntry,
  uploadToken,
  verifyPasscode,
  type Ctx,
} from './handlers.js';
import { errorResponse, json } from './http.js';

type Handler = (ctx: Ctx) => Promise<Response>;

const routes: Array<{ method: string; pattern: string; handler: Handler }> = [
  { method: 'GET', pattern: 'day', handler: getDay },
  { method: 'GET', pattern: 'history', handler: getHistory },
  { method: 'GET', pattern: 'setup', handler: getSetup },
  { method: 'POST', pattern: 'day/submit', handler: submitDay },
  { method: 'POST', pattern: 'entries', handler: createEntry },
  { method: 'PATCH', pattern: 'entries/:id', handler: updateEntry },
  { method: 'DELETE', pattern: 'entries/:id', handler: deleteEntry },
  { method: 'PUT', pattern: 'attendance', handler: setAttendance },
  { method: 'PUT', pattern: 'marks', handler: setMark },
  { method: 'POST', pattern: 'admin/verify', handler: verifyPasscode },
  { method: 'POST', pattern: 'admin/import', handler: runImport },
  { method: 'POST', pattern: 'files/upload', handler: uploadToken },
  { method: 'GET', pattern: 'files', handler: getFile },
];

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/** Single entry point for every /api route (vercel.json rewrites /api/* here). */
export async function handle(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get('__path') ?? url.pathname.replace(/^\/api(?=\/|$)/, '');
    const path = raw.replace(/^\/+|\/+$/g, '');
    const method = request.method.toUpperCase();

    let allowed = false;
    for (const route of routes) {
      const params = match(route.pattern, path);
      if (!params) continue;
      allowed = true;
      if (route.method !== method) continue;
      return await route.handler({ request, url, params });
    }
    if (method === 'OPTIONS') return new Response(null, { status: 204 });
    return allowed ? json({ error: 'Method not allowed.' }, 405) : json({ error: 'Not found.' }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
