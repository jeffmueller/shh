import { NextResponse } from "next/server";

// CSP set in middleware so a static `script-src 'self'` from next.config.ts
// can't accidentally block Next.js's inline RSC hydration scripts (which
// don't always carry a nonce in Next 16, breaking React hydration).
//
// XSS defense for this app does NOT rely on CSP's script restrictions:
// secret content is rendered through React text interpolation inside <pre>,
// which auto-escapes. CSP's role here is to lock down what *external*
// resources can load (fonts, images, fetch, frames, plugins).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function middleware() {
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", CSP);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
