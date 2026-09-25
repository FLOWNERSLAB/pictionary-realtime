/**
 * Vercel Routing Middleware: one shared password in front of the whole deployed lab.
 * The API routes spend the team's fal and Daydream credit, so the public URL cannot
 * be open. Browsers keep Basic credentials for the origin, so the page's own fetch
 * calls to /api pass without asking again.
 *
 * Password in LAB_PASSWORD (Vercel → Settings → Environment Variables); any user name
 * works. Without LAB_PASSWORD the gate is off. Only Vercel runs this file: `npm run dev`
 * stays open on localhost.
 */
export const config = { matcher: '/:path*' };

const deny = () =>
  new Response('Hace falta la contraseña del lab.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="AI Pictionary lab", charset="UTF-8"' },
  });

export default function middleware(request: Request) {
  const password = process.env.LAB_PASSWORD;

  if (!password) return;

  const [scheme, encoded] = (request.headers.get('authorization') ?? '').split(' ');

  if (scheme !== 'Basic' || !encoded) return deny();

  try {
    const decoded = atob(encoded);

    if (decoded.slice(decoded.indexOf(':') + 1) !== password) return deny();
  } catch {
    return deny();
  }

  // Nothing returned: the request goes on to the page or the function.
}
