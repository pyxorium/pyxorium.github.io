// auth.js (copied from src/sevenup/auth.js, Oct 18): signing in to sit, and saving a match record, for the Daisy table.
//
// Uses @atproto/oauth-client-browser (the version the Foundry pins, 0.5.8). Each player signs in in a
// small window (the library's popup sign-in); several accounts can be signed in at once, and the
// library keeps each one in this browser (IndexedDB) so the next visit can carry on without a window.
// Since step 6 the permissions are Daisy's permission sets (config.js): signing in to sit asks for "Play
// Daisy" (SIT_SCOPE: the match records only); turning mingling on asks for "Daisy lounge" as well
// (LOUNGE_SCOPE: the lounge record and a pass for the relay).
//
// createAuth(lib) takes the library's exports, so the browser checks can hand in a stand-in.
import { CLIENT_ID, SCOPE, SIT_SCOPE, PAGE_PATH, SIGNIN_HANDLE_RESOLVER, ACCOUNTS_KEY, RELAY_AUDIENCE, LOUNGE_ENTER, hasLoungeScope } from './config.js';

const WINDOW_NAME = 'daisy-signin';
const WINDOW_FEATURES = 'width=600,height=700,menubar=no,toolbar=no';

export class SignInNeeded extends Error {}

export function isLocal(loc = globalThis.location) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(loc.hostname);
}

// On this computer: a loopback sign-in (no description file needed; the sign-in server builds one
// from this address). The page must be opened at 127.0.0.1, not localhost (the library moves it).
export function clientIdFor(loc = globalThis.location) {
  if (!isLocal(loc)) return CLIENT_ID;
  const port = loc.port ? `:${loc.port}` : '';
  return `http://localhost?redirect_uri=${encodeURIComponent(`http://127.0.0.1${port}${PAGE_PATH}`)}&scope=${encodeURIComponent(SCOPE)}`;
}

// ---- accounts remembered on this browser: [{ did, handle }] (DIDs count; handles for display) ----
export function rememberedAccounts() {
  try {
    const list = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((a) => a && typeof a.did === 'string' && typeof a.handle === 'string').slice(0, 10) : [];
  } catch { return []; }
}
function remember(did, handle) {
  const list = rememberedAccounts().filter((a) => a.did !== did);
  list.unshift({ did, handle });
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list.slice(0, 10))); } catch { /* fine */ }
}
function forget(did) {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(rememberedAccounts().filter((a) => a.did !== did))); } catch { /* fine */ }
}

export function createAuth({ BrowserOAuthClient, LoginContinuedInParentWindowError }) {
  let client = null;
  const sessions = new Map();          // did → session
  const listeners = new Set();

  return {
    // Once per page load, before anything else. In the sign-in window itself this finishes the
    // sign-in and returns { finishedInWindow: true } (the library then closes the window).
    async start() {
      try {
        client = await BrowserOAuthClient.load({ clientId: clientIdFor(), handleResolver: SIGNIN_HANDLE_RESOLVER });
        await client.init();
        client.addEventListener?.('deleted', (e) => {
          const did = e && e.detail && e.detail.sub;
          if (!did) return;
          sessions.delete(did);
          listeners.forEach((fn) => fn(did));
        });
        return {};
      } catch (err) {
        if ((LoginContinuedInParentWindowError && err instanceof LoginContinuedInParentWindowError) || (err && err.code === 'LOGIN_CONTINUED_IN_PARENT_WINDOW')) {
          return { finishedInWindow: true };
        }
        if (err && /Redirecting to loopback/.test(String(err.message))) return { moving: true };
        console.error('[daisy] sign-in could not start', err);
        return { error: err };
      }
    },
    ready: () => !!client,
    onSignedOut: (fn) => listeners.add(fn),

    // Call straight from a click, before anything that waits: browsers only allow a new window then.
    // Returns the window, or null when it was blocked.
    openWindow() {
      try { return window.open('about:blank', WINDOW_NAME, WINDOW_FEATURES); } catch { return null; }
    },

    // scope: SIT_SCOPE (to sit) or LOUNGE_SCOPE (to mingle; it includes sitting).
    async signIn(handle, signal, { scope = SIT_SCOPE } = {}) {
      const session = await client.signInPopup(handle, { popupName: WINDOW_NAME, popupFeatures: WINDOW_FEATURES, signal, scope });
      sessions.set(session.did, session);
      return { did: session.did };
    },

    // Can this browser's sign-in for the account enter the lounge (the "Daisy lounge" permissions)?
    async canMingle(did) {
      if (!sessions.has(did) && !(await this.restore(did))) return false;
      try {
        const info = await sessions.get(did).getTokenInfo();
        return hasLoungeScope(info && info.scope);
      } catch { return false; }
    },

    // A pass for Daisy's relay: a short token from the account's own server (getServiceAuth), addressed to
    // the relay and to the lounge only. Good for a minute; each one is used once.
    async getPass(did) {
      const q = new URLSearchParams({ aud: RELAY_AUDIENCE, lxm: LOUNGE_ENTER, exp: String(Math.floor(Date.now() / 1000) + 60) });
      const body = await this.call(did, `com.atproto.server.getServiceAuth?${q}`, { method: 'GET' });
      if (!body || typeof body.token !== 'string') throw new Error('no pass');
      return body.token;
    },

    // One XRPC call with the account's sign-in. SignInNeeded when it has run out.
    async call(did, nsidAndQuery, { method = 'POST', body } = {}) {
      let session = sessions.get(did);
      if (!session && !(await this.restore(did))) throw new SignInNeeded('signed out');
      session = sessions.get(did);
      let res;
      try {
        res = await session.fetchHandler(`/xrpc/${nsidAndQuery}`, {
          method,
          ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
        });
      } catch (err) {
        if (/token|session|refresh|revoked|auth/i.test(String(err && (err.name + ' ' + err.message)))) { sessions.delete(did); throw new SignInNeeded(String(err.message)); }
        throw err;
      }
      const out = await res.json().catch(() => ({}));
      if (res.status === 401) { sessions.delete(did); throw new SignInNeeded(out.message || 'unauthorized'); }
      if (!res.ok) throw Object.assign(new Error(out.message || out.error || `The server answered ${res.status}`), { status: res.status, error: out.error });
      return out;
    },

    // An account signed in on this browser earlier: no window needed. Null when it's no longer valid.
    async restore(did) {
      if (sessions.has(did)) return true;
      try {
        const session = await client.restore(did);
        sessions.set(did, session);
        return true;
      } catch {
        forget(did);
        return false;
      }
    },

    remember,
    async signOut(did) {
      sessions.delete(did);
      forget(did);
      try { await client.revoke(did); } catch { /* already gone */ }
    },

    // Writes one record (com.atproto.repo.putRecord): saving again with the same key replaces it.
    async putRecord(did, { collection, rkey, record }) {
      let session = sessions.get(did);
      if (!session && !(await this.restore(did))) throw new SignInNeeded('signed out');
      session = sessions.get(did);
      let res;
      try {
        res = await session.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repo: did, collection, rkey, record }),
        });
      } catch (err) {
        if (/token|session|refresh|revoked|auth/i.test(String(err && (err.name + ' ' + err.message)))) {
          sessions.delete(did);
          throw new SignInNeeded(String(err.message));
        }
        throw err;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) { sessions.delete(did); throw new SignInNeeded(body.message || 'unauthorized'); }
      if (!res.ok) throw new Error(body.message || body.error || `The server answered ${res.status}`);
      return { uri: body.uri, cid: body.cid };
    },
  };
}
