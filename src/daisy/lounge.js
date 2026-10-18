// lounge.js: Daisy's lounge on the page (build step 6). Mingling is a lasting opt-in: a lounge record in
// your own account (cafe.thunderbird.daisy.lounge/self). While mingling, signed in, and on the start
// screen (not at a table), this page sits in the relay's lounge (wss://relay.daisy.thunderbird.cafe/lounge),
// entering with a pass from your own server that proves to the relay who you are. Pressing "Who else is
// mingling?" asks for a snapshot of the others who are here; Invite knocks on someone's page; Play on an
// invitation sends both pages to a new table (owner's decisions, Oct 17 and 18: claude/daisy-step6.md).
//
// mountLounge(root, deps) works inside the Daisy page's markup (markup.js). deps:
//   auth                 the page's sign-in (auth.js): restore, canMingle, signIn, openWindow, call, getPass, remember
//   getHandle()          the handle typed in the lobby (or the last account), for signing in
//   onTable({ table, seat, did, handle, withDid })   go to the table both players said yes to
//   url                  the lounge address (config.js loungeUrl), null when there's no relay
import { rememberedAccounts, SignInNeeded } from './auth.js';
import { cleanHandle, looksLikeHandle, resolveHandle, profilesOf, hasLoungeRecord } from './identity.js';
import { LOUNGE_SCOPE, LOUNGE_COLLECTION, LOUNGE_TIMES as TIMES, timerSet } from './config.js';

const OFF_TEXT = 'Off. Turn it on to see other mingling Daisy players who are here now, and let them see you.';
const ON_TEXT = 'Mingling: other mingling players can see you while you\'re on this page.';

export function mountLounge(root, { auth, authProblem = null, getHandle, onTable, url, WebSocketImpl = globalThis.WebSocket, fetchImpl = (...a) => fetch(...a), log = () => {}, loc = globalThis.location }) {
  // With ?timers=short on this computer, "No answer" comes after 4 s (for the checks), as the game's short timers.
  const LOUNGE_TIMES = timerSet(loc) === 'short' ? { ...TIMES, noAnswer: 4000 } : TIMES;
  const $ = (s) => root.querySelector(s);
  const panel = $('.dz-lounge');
  const sw = $('.dz-switch');
  const dialog = $('.dz-ldialog');
  let account = null;          // { did, handle } of the mingling account
  let mingling = false;        // the record exists (as far as this page knows)
  let state = 'off';           // off | joining | here | idle | needs-signin | away (another window) | unavailable | left
  let ws = null, retry = 0, retryTimer = null, lastHereSent = 0;
  let knock = null;            // { id, from, expires, timer }
  const invited = new Map();   // did → timer (Invite sent → No answer)
  let pendingDialog = null;
  let leaving = false;

  const note = (text) => { $('.dz-lounge-note').textContent = text; };
  function show() {
    sw.setAttribute('aria-checked', String(mingling));
    $('.dz-who').hidden = state !== 'here';
    $('.dz-lounge-retry').hidden = !['needs-signin', 'idle', 'away', 'left'].includes(state);
    $('.dz-lounge-retry').textContent = state === 'needs-signin' ? 'Sign in to the lounge' : 'Rejoin the lounge';
    if (state === 'off') note(OFF_TEXT);
    else if (state === 'joining') note(`Joining the lounge as @${account.handle}…`);
    else if (state === 'here') note(`${ON_TEXT} (as @${account.handle})`);
  }
  root.dataset.lounge = 'off';
  const setState = (s, text) => { state = s; root.dataset.lounge = s; show(); if (text) note(text); };
  show();

  // ---------- at load: already mingling from this browser? ----------
  async function start() {
    if (authProblem || !auth || !auth.ready()) { sw.disabled = true; note("The lounge needs signing in, which isn't working on this page right now."); return; }
    const last = rememberedAccounts()[0];
    if (!last) return;
    let has = false;
    try { has = await hasLoungeRecord(last.did, fetchImpl); } catch { return; }
    if (!has) return;
    account = last; mingling = true;
    if (await auth.canMingle(last.did)) join();
    else setState('needs-signin', `You mingle as @${last.handle}, but this browser's lounge sign-in has run out.`);
  }

  // ---------- the switch ----------
  sw.addEventListener('click', () => {
    if (sw.disabled) return;
    if (mingling) return turnOff();
    const handle = account ? account.handle : cleanHandle(getHandle());
    if (!looksLikeHandle(handle)) { note('Type your handle above first, like you.bsky.social.'); return; }
    const known = rememberedAccounts().find((a) => a.handle === handle);
    pendingDialog = { handle, known, can: false };
    // Whether this browser can already mingle as that account is found out now, so Continue (a click) can
    // open the sign-in window at once when it can't: browsers only allow a window straight from a click.
    const asked = pendingDialog;
    if (known) auth.canMingle(known.did).then((v) => { asked.can = v; }, () => {});
    // The explanation comes first (owner, Oct 18), each time someone turns mingling on.
    $('.dz-ldialog-status').textContent = '';
    dialog.hidden = false;
    $('.dz-ldialog-yes').focus();
  });
  $('.dz-ldialog-no').addEventListener('click', () => { dialog.hidden = true; pendingDialog = null; });
  // Continue: straight from the click, as a sign-in window may have to open.
  $('.dz-ldialog-yes').addEventListener('click', () => {
    if (!pendingDialog) return;
    const { handle, known, can } = pendingDialog;
    withLoungeSignIn(handle, can ? known : null, async (who) => {
      dialog.hidden = true; pendingDialog = null;
      account = who;
      try {
        await auth.call(who.did, 'com.atproto.repo.putRecord', { body: { repo: who.did, collection: LOUNGE_COLLECTION, rkey: 'self', record: { $type: LOUNGE_COLLECTION, createdAt: new Date().toISOString() } } });
      } catch (err) {
        console.warn('[daisy] lounge record', err);
        return note(err instanceof SignInNeeded ? 'The sign-in ran out. Try again.' : "Couldn't turn mingling on. Try again.");
      }
      mingling = true;
      join();
    }, (text) => { $('.dz-ldialog-status').textContent = text; });
  });

  $('.dz-lounge-retry').addEventListener('click', () => {
    if (!account) return;
    if (state === 'needs-signin') return withLoungeSignIn(account.handle, null, () => join(), note);
    join();
  });

  // Signed in with the lounge's permissions ("Daisy lounge"). ready: an account this browser already holds
  // them for (no window); otherwise the window opens straight away (this runs from a click).
  async function withLoungeSignIn(handle, ready, then, say) {
    if (ready) return then(ready);
    const win = auth.openWindow();
    if (!win) return say('The sign-in window was blocked. Allow pop-ups for this page, then try again.');
    say(`Signing in as @${handle}: approve “Daisy lounge” in the small window.`);
    const ac = new AbortController();
    try {
      const { did } = await auth.signIn(handle, ac.signal, { scope: LOUNGE_SCOPE });
      let named = null;
      try { named = await resolveHandle(handle, fetchImpl); } catch { named = null; }
      if (named !== did) { say(named ? `That sign-in was for a different account than @${handle}. Try again.` : `Couldn't check @${handle}. Try again.`); return; }
      if (!(await auth.canMingle(did))) { say('The lounge permissions weren\'t given, so mingling stays off.'); return; }
      auth.remember(did, handle);
      say('');
      then({ did, handle });
    } catch (err) {
      console.warn('[daisy] lounge sign-in', err);
      say("Sign-in didn't finish. Try again.");
    }
  }

  async function turnOff() {
    if (!account) return;
    sw.disabled = true;
    note('Turning mingling off…');
    leave();
    try {
      if (!(await auth.canMingle(account.did))) throw new SignInNeeded('no lounge sign-in');
      await auth.call(account.did, 'com.atproto.repo.deleteRecord', { body: { repo: account.did, collection: LOUNGE_COLLECTION, rkey: 'self' } });
      mingling = false;
      setState('off');
    } catch (err) {
      console.warn('[daisy] lounge off', err);
      setState('needs-signin', `Couldn't delete the lounge record: sign in to the lounge as @${account.handle}, then turn mingling off again.`);
    } finally { sw.disabled = false; }
  }

  // ---------- the relay's lounge ----------
  function join() {
    if (!account || !mingling) return;
    if (!url) { setState('unavailable', 'The lounge needs the relay, and this page has none.'); return; }
    clearTimeout(retryTimer);
    leaving = false;
    if (ws) { try { ws.close(); } catch { /* fine */ } }
    setState('joining');
    let socket;
    try { socket = new WebSocketImpl(url); } catch { return later(); }
    ws = socket;
    socket.onopen = async () => {
      try {
        const pass = await auth.getPass(account.did);
        if (ws === socket) socket.send(JSON.stringify({ type: 'enter', pass }));
      } catch (err) {
        console.warn('[daisy] lounge pass', err);
        if (ws === socket) { leaving = true; socket.close(); }
        setState('needs-signin', `Couldn't get a lounge pass for @${account.handle}: sign in to the lounge again.`);
      }
    };
    socket.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (ws === socket) onMessage(m); };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      if (leaving || !mingling || !['joining', 'here'].includes(state)) return;
      later();
    };
    socket.onerror = () => {};
  }
  function later() {
    const wait = LOUNGE_TIMES.reconnect[Math.min(retry, LOUNGE_TIMES.reconnect.length - 1)];
    retry++;
    setState('joining', retry > 2 ? 'Can\'t reach the lounge right now. Trying again…' : null);
    retryTimer = setTimeout(join, wait);
  }
  function leave() {
    leaving = true;
    clearTimeout(retryTimer);
    if (ws) { try { ws.close(); } catch { /* fine */ } ws = null; }
    hideKnock();
  }
  const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

  function onMessage(m) {
    log({ dir: 'in', from: 'lounge', kind: m.type, why: m.why });
    switch (m.type) {
      case 'in': retry = 0; lastHereSent = Date.now(); setState('here'); break;
      case 'refused':
        leaving = true;
        if (m.why === 'NoLoungeRecord') { mingling = false; setState('off', 'Your account has no lounge record any more, so mingling is off.'); }
        else if (m.why === 'NotReady') setState('unavailable', 'The lounge isn\'t open right now. Try again later.');
        else setState('needs-signin', 'The relay didn\'t accept this page\'s lounge pass: sign in to the lounge again.');
        break;
      case 'idle': leaving = true; setState('idle', 'You left the lounge after 10 minutes away. Touch the page, or press Rejoin, to come back.'); break;
      case 'replaced': leaving = true; setState('away', `@${account.handle} is mingling in another window now.`); break;
      case 'people': showPeople(m); break;
      case 'invited': break;                       // the same answer whatever happens next
      case 'knock': showKnock(m); break;
      case 'knock-gone': if (knock && knock.id === m.id) { hideKnock(); note('That invitation has run out.'); } break;
      case 'table': goToTable(m); break;
      case 'error': if (m.why === 'too many' && m.did) markPerson(m.did, 'Wait a few minutes'); break;
    }
  }

  // Someone touched the page: the relay keeps you here (10 minutes otherwise; owner, Oct 18). Back after
  // going idle, the lounge is joined again by itself.
  function touched() {
    if (state === 'idle' && mingling) { join(); return; }
    if (state === 'here' && Date.now() - lastHereSent > LOUNGE_TIMES.hereEvery) { lastHereSent = Date.now(); send({ type: 'here' }); }
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, touched, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') touched(); });

  // ---------- who else is mingling ----------
  $('.dz-who-ask').addEventListener('click', () => { $('.dz-who-note').textContent = 'Looking…'; send({ type: 'who' }); });
  async function showPeople(m) {
    const list = $('.dz-people');
    const when = new Date(m.at);
    $('.dz-who-time').textContent = `As of ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · press again to refresh`;
    list.textContent = '';
    if (m.problem) { $('.dz-who-note').textContent = "Couldn't check right now; try again in a moment."; return; }
    if (!m.people.length) { $('.dz-who-note').textContent = 'Nobody else is mingling here right now. Try again in a while, or open a table and send the link.'; return; }
    $('.dz-who-note').textContent = '';
    const profiles = await profilesOf(m.people, fetchImpl);
    for (const did of m.people) {
      const p = profiles.get(did) || {};
      const li = document.createElement('li');
      li.className = 'dz-person';
      li.dataset.did = did;
      const pic = p.avatar ? Object.assign(document.createElement('img'), { src: p.avatar, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : document.createElement('span');
      pic.className = 'dz-pic';
      const words = document.createElement('span');
      words.className = 'dz-person-words';
      const h = document.createElement('div'); h.className = 'dz-person-handle'; h.textContent = p.handle ? `@${p.handle}` : did;
      const n = document.createElement('div'); n.className = 'dz-person-name'; n.textContent = p.name || '';
      words.append(h, n);
      li.append(pic, words);
      if (invited.has(did)) li.append(stateTag(invited.get(did).text));
      else li.append(inviteButton(did, p.handle));
      list.append(li);
    }
  }
  function stateTag(text) { const s = document.createElement('span'); s.className = 'dz-person-state'; s.textContent = text; return s; }
  function inviteButton(did) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Invite';
    b.addEventListener('click', () => {
      send({ type: 'invite', did });
      const entry = { text: 'Invite sent' };
      entry.timer = setTimeout(() => { entry.text = 'No answer'; markPerson(did, 'No answer'); setTimeout(() => { invited.delete(did); markPerson(did, null); }, LOUNGE_TIMES.noAnswer); }, LOUNGE_TIMES.noAnswer);
      invited.set(did, entry);
      markPerson(did, 'Invite sent');
    });
    return b;
  }
  // A row's right-hand side: a state ("Invite sent", "No answer") or, with null, the Invite button again.
  function markPerson(did, text) {
    const li = $(`.dz-person[data-did="${CSS.escape(did)}"]`);
    if (!li) return;
    li.lastElementChild.remove();
    li.append(text ? stateTag(text) : inviteButton(did));
  }

  // ---------- an invitation ----------
  async function showKnock(m) {
    hideKnock();
    const expires = Date.parse(m.expiresAt) || Date.now() + 60000;
    knock = { id: m.id, from: m.from, expires };
    const card = $('.dz-knock');
    const who = (await profilesOf([m.from], fetchImpl)).get(m.from);
    if (!knock || knock.id !== m.id) return;
    knock.handle = who && who.handle;
    const b = document.createElement('b');
    b.textContent = who && who.handle ? `@${who.handle}` : 'Someone';
    const text = $('#dz-knock-text');
    text.textContent = '';
    text.append(b, ' invites you to a game of Daisy.');
    card.hidden = false;
    const bar = $('.dz-knock-bar span');
    const left = Math.max(0, expires - Date.now());
    bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)';
    requestAnimationFrame(() => { bar.style.transition = `transform ${left}ms linear`; bar.style.transform = 'scaleX(0)'; });
    knock.timer = setTimeout(hideKnock, left);
  }
  function hideKnock() {
    if (knock) clearTimeout(knock.timer);
    knock = null;
    $('.dz-knock').hidden = true;
  }
  $('.dz-knock-play').addEventListener('click', () => { if (knock) { send({ type: 'answer', id: knock.id, play: true }); note('Opening the table…'); } });
  // Not now: the relay drops the invitation (so another can arrive) and tells the inviter nothing (owner, Oct 18).
  $('.dz-knock-no').addEventListener('click', () => { if (knock) send({ type: 'answer', id: knock.id, play: false }); hideKnock(); });

  // ---------- both said yes ----------
  async function goToTable(m) {
    const other = m.with;
    let handle = knock && knock.from === other ? knock.handle : null;
    if (!handle) { const p = (await profilesOf([other], fetchImpl)).get(other); handle = p && p.handle; }
    note(m.seat === 1 ? `${handle ? '@' + handle : 'They'} said yes! Opening the table…` : 'Opening the table…');
    leave();
    for (const e of invited.values()) clearTimeout(e.timer);
    invited.clear();
    onTable({ table: m.table, seat: m.seat, did: account.did, handle: account.handle, withDid: other });
  }

  start();
  return {
    // The page opened or joined a table: out of the lounge (mingling itself stays on).
    leaveForTable() { leave(); panel.hidden = true; },
    get state() { return state; }, get account() { return account; }, get mingling() { return mingling; },
  };
}
