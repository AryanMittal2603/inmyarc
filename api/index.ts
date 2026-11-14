import { handle } from '../server/router.js';

// Every /api/* request is rewritten here (see vercel.json) and routed in server/router.ts.
export default {
  fetch(request: Request): Promise<Response> {
    return handle(request);
  },
};
