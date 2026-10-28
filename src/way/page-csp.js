// page-csp.js: the way pages' security policy, a <meta> tag on the built page only (GitHub Pages can't send
// headers; Astro's dev server adds inline scripts of its own). Since the travel page (Winter Forest step 3):
//   lookups over https (plc.directory, each account's own server: signposts, places, tile records and files);
//   pictures over https (the doors' icons from those servers);
//   frames: only the tile loading server (each tile on its own random name under it), as the Rooms lab.
// The page passes the site's loading server (src/lib/tile-load-domain.js), so this file stands alone.
// COPY in the site; the source is C:\thunderbird-cafe\maze-tiles\site\. Edit it there.
export function pageCsp(loadDomain, { scheme = 'https' } = {}) {
  const base = loadDomain.replace(/^load\./, '');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "connect-src 'self' https:",
    `frame-src ${scheme}://${loadDomain} ${scheme}://*.${base}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}
