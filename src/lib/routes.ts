/** The app's addresses. Vercel serves index.html for all of them; this picks the screen. */

export type Route =
  | { page: 'home' }
  | { page: 'team'; slug: string }
  | { page: 'manager'; slug: string }
  | { page: 'admin' }
  | { page: 'missing' };

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function routeOf(pathname: string): Route {
  const parts = pathname
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  if (parts.length === 0) return { page: 'home' };
  const [first, second, ...rest] = parts;
  const head = first.toLowerCase();
  if (rest.length > 0) return { page: 'missing' };
  if (head === 'admin' && second === undefined) return { page: 'admin' };
  if ((head === 'task' || head === 'rating') && second === undefined) return { page: 'home' };
  if ((head === 'task' || head === 'rating') && second !== undefined) {
    const slug = second.toLowerCase();
    if (!SLUG.test(slug)) return { page: 'missing' };
    return head === 'task' ? { page: 'team', slug } : { page: 'manager', slug };
  }
  return { page: 'missing' };
}

/** Lowercase, tidy form of the current address (so /Task/Alpha/ becomes /task/alpha). */
export function canonicalPath(route: Route): string | null {
  switch (route.page) {
    case 'home':
      return '/';
    case 'team':
      return `/task/${route.slug}`;
    case 'manager':
      return `/rating/${route.slug}`;
    case 'admin':
      return '/admin';
    default:
      return null;
  }
}

export const links = {
  board: (slug: string) => `/task/${slug}`,
  rating: (slug: string) => `/rating/${slug}`,
  absolute: (path: string) => `${window.location.origin}${path}`,
};

/** "inmyarc.com/task/alpha" — what people see and bookmark. */
export function displayLink(path: string): string {
  return `${window.location.host.replace(/^www\./, '')}${path}`;
}

/** Turns a name into a link name: "Asha Rao" → "asha-rao". */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}
