// page-csp.js: the way pages' security policy, a <meta> tag on the built page only (GitHub Pages can't send
// headers; Astro's dev server adds inline scripts of its own). The page only reads: lookups over https
// (plc.directory, each account's own server) and the destinations' icons from those servers. No frames.
// COPY in the site; the source is C:\thunderbird-cafe\maze-tiles\site\. Edit it there.
export function pageCsp() {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "connect-src 'self' https:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}
