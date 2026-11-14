import {
  adminOverview,
  createEntry,
  createManager,
  createMember,
  deleteEntry,
  deleteManager,
  deleteMember,
  getDay,
  getFile,
  getHistory,
  getSession,
  getSetup,
  getTeams,
  loginAdmin,
  loginManager,
  logout,
  runImport,
  setAttendance,
  setMark,
  submitDay,
  updateEntry,
  updateManager,
  updateMember,
  updateSettings,
  uploadToken,
  type Ctx,
} from './handlers.js';
import { errorResponse, json } from './http.js';

type Handler = (ctx: Ctx) => Promise<Response>;

const routes: Array<{ method: string; pattern: string; handler: Handler }> = [
  // public
  { method: 'GET', pattern: 'setup', handler: getSetup },
  { method: 'GET', pattern: 'teams', handler: getTeams },
  { method: 'GET', pattern: 'day', handler: getDay },
  { method: 'GET', pattern: 'history', handler: getHistory },
  // sign-in
  { method: 'GET', pattern: 'auth/session', handler: getSession },
  { method: 'POST', pattern: 'auth/admin', handler: loginAdmin },
  { method: 'POST', pattern: 'auth/manager', handler: loginManager },
  { method: 'POST', pattern: 'auth/logout', handler: logout },
  // the day's work (team boards, managers, super admin)
  { method: 'POST', pattern: 'day/submit', handler: submitDay },
  { method: 'POST', pattern: 'entries', handler: createEntry },
  { method: 'PATCH', pattern: 'entries/:id', handler: updateEntry },
  { method: 'DELETE', pattern: 'entries/:id', handler: deleteEntry },
  { method: 'PUT', pattern: 'attendance', handler: setAttendance },
  { method: 'PUT', pattern: 'marks', handler: setMark },
  // super admin
  { method: 'GET', pattern: 'admin/overview', handler: adminOverview },
  { method: 'POST', pattern: 'admin/managers', handler: createManager },
  { method: 'PATCH', pattern: 'admin/managers/:id', handler: updateManager },
  { method: 'DELETE', pattern: 'admin/managers/:id', handler: deleteManager },
  { method: 'POST', pattern: 'admin/members', handler: createMember },
  { method: 'PATCH', pattern: 'admin/members/:id', handler: updateMember },
  { method: 'DELETE', pattern: 'admin/members/:id', handler: deleteMember },
  { method: 'PUT', pattern: 'admin/settings', handler: updateSettings },
  { method: 'POST', pattern: 'admin/import', handler: runImport },
  // files
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

    // Writes must be JSON from this site: blocks cross-site form posts (cookies are SameSite=Lax too).
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && path !== 'files/upload') {
      const type = request.headers.get('content-type') ?? '';
      if (!type.includes('application/json')) return json({ error: 'Send JSON.' }, 415);
    }

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
