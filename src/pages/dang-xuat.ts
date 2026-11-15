import type { APIRoute } from 'astro';
import { COOKIE, destroySession } from '../lib/auth';
export const POST: APIRoute = async ({ locals, cookies, redirect }) => {
  if (locals.sid) await destroySession(locals.sid);
  cookies.delete(COOKIE, { path: '/' });
  return redirect('/dang-nhap');
};
