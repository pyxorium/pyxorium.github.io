// The Daisy page's markup (used by table.js and by the browser checks).
import { BOT } from './config.js';

// A small outline robot after the bot's name (the drawing on Seven-Up's bot button).
const ROBOT = `<svg class="dz-robot" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="12" y1="2.5" x2="12" y2="5.5"/><circle cx="12" cy="2.3" r="0.6" fill="currentColor"/><rect x="4.5" y="6" width="15" height="12" rx="3.5"/><circle cx="9.3" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.7" cy="12" r="1.3" fill="currentColor" stroke="none"/><line x1="2.5" y1="11" x2="2.5" y2="13.5"/><line x1="21.5" y1="11" x2="21.5" y2="13.5"/></svg>`;

export const MARKUP = `
<header class="dz-head">
  <h1>Daisy <span aria-hidden="true">🌼</span></h1>
  <p class="dz-lede">A dice race for two players. One die: roll as often as you like, but a 1 loses the turn. Bank to keep your points. First to 25 wins.</p>
</header>

<p class="dz-account" hidden><span class="dz-account-text"></span>
  <button class="dz-signout dz-linkish" type="button" hidden>Sign out</button>
  <button class="dz-again dz-linkish" type="button" hidden>Sign in again</button>
  <button class="dz-home dz-linkish" type="button" hidden>Back to the start</button></p>

<ul class="dz-going" hidden></ul>

<section class="dz-lobby" aria-label="Sign in">
  <label class="dz-field">Your handle
    <input class="dz-handle" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="you.bsky.social">
  </label>
  <div class="dz-lobby-actions">
    <button class="dz-signin" type="button">Sign in</button>
    <button class="dz-cancel quiet" type="button" hidden>Cancel</button>
  </div>
  <p class="dz-lobby-note" aria-live="polite"></p>
  <p class="dz-lobby-hint">Signing in asks your account for <b>“Play Daisy”</b>: saving the matches you finish, and nothing else. A small window opens the first time.</p>
</section>

<section class="dz-play dz-waiting" aria-label="Play">
  <button class="dz-open" type="button" disabled>Open a table</button>
  <button class="dz-sit" type="button" hidden disabled>Take a seat</button>
  <button class="dz-bot quiet" type="button" disabled>Play the bot ${ROBOT}</button>
  <p class="dz-play-text">You get a link to send to a friend.</p>
  <p class="dz-bot-text">Or play @${BOT.handle}, the table's bot, right here: no timers, and you can save the match.</p>
  <div class="dz-back" hidden></div>
</section>

<section class="dz-lounge dz-waiting" aria-label="Lounge">
  <h2>Lounge</h2>
  <div class="dz-switch-row">
    <button class="dz-switch" type="button" role="switch" aria-checked="false" aria-labelledby="dz-mingle-label" disabled></button>
    <span class="dz-switch-label" id="dz-mingle-label">Mingle</span>
  </div>
  <p class="dz-lounge-note" aria-live="polite">Sign in above to mingle. Joining the lounge requires one additional authorization.</p>
  <button class="dz-lounge-retry quiet" type="button" hidden>Rejoin the lounge</button>
  <div class="dz-who" hidden>
    <div class="dz-who-head"><button class="dz-who-ask quiet" type="button">Who else is mingling?</button><span class="dz-who-time"></span></div>
    <p class="dz-who-note" aria-live="polite"></p>
    <ul class="dz-people"></ul>
  </div>
</section>

<div class="dz-knock" role="alertdialog" aria-labelledby="dz-knock-text" hidden>
  <p id="dz-knock-text"></p>
  <div class="dz-knock-actions"><button class="dz-knock-play" type="button">Play</button><button class="dz-knock-no quiet" type="button">Not now</button></div>
  <div class="dz-knock-bar"><span></span></div>
</div>

<div class="dz-ldialog" hidden>
  <div class="dz-dialog-box" role="dialog" aria-modal="true" aria-labelledby="dz-ldialog-title">
    <h2 id="dz-ldialog-title">Turn on mingling?</h2>
    <p class="dz-dialog-text">While you mingle and this page is open (not at a table), other mingling Daisy players who ask can see you and invite you to a game, and you can see and invite them. Players who have blocked you, or whom you've blocked, never see each other.</p>
    <p class="dz-dialog-text dz-ldialog-first">Mingling needs <b>one additional authorization</b> from your account, <b>“Daisy lounge”</b> (only this first time): a lounge record in your account (it only says that you've chosen to mingle, not whether you're here or signed in) and a pass that proves to Daisy's relay who you are. Turning mingling off deletes the record.</p>
    <p class="dz-ldialog-status" aria-live="polite"></p>
    <div class="dz-dialog-actions"><button type="button" class="dz-ldialog-yes">Continue</button><button type="button" class="dz-ldialog-no quiet">Not now</button></div>
  </div>
</div>

<section class="dz-invite" hidden>
  <p>Send this link to the other player:</p>
  <div class="dz-invite-row"><input class="dz-link" readonly><button class="dz-copy quiet" type="button">Copy</button></div>
</section>

<p class="dz-status" aria-live="polite" hidden></p>

<section class="dz-table" hidden>
  <div class="dz-seat dz-mine" data-role="mine">
    <div class="dz-mount"></div>
    <div class="dz-tile-status" hidden><p></p><button class="dz-retry quiet" type="button" hidden>Try again</button></div>
  </div>
  <div class="dz-seat dz-theirs" data-role="theirs">
    <div class="dz-mount"></div>
    <div class="dz-tile-status" hidden><p></p><button class="dz-retry quiet" type="button" hidden>Try again</button></div>
  </div>
  <div class="dz-house-mount"></div>
  <div class="dz-bot-mount"></div>
  <div class="dz-house-note" hidden><p></p><button class="dz-house-retry quiet" type="button" hidden>Try again</button></div>
</section>

<div class="dz-after" hidden><button class="dz-after-lounge quiet" type="button">Back to the lounge</button></div>

<div class="dz-leave" hidden>
  <div class="dz-dialog-box" role="dialog" aria-modal="true" aria-labelledby="dz-leave-title">
    <h2 id="dz-leave-title">Leave this match?</h2>
    <p class="dz-dialog-text dz-leave-text">If you don't come back within 2 minutes, it ends by forfeit.</p>
    <div class="dz-dialog-actions"><button type="button" class="dz-leave-yes">Leave</button><button type="button" class="dz-leave-no quiet">Stay</button></div>
  </div>
</div>

<div class="dz-dialog" hidden>
  <div class="dz-dialog-box" role="dialog" aria-modal="true" aria-labelledby="dz-dialog-title">
    <h2 id="dz-dialog-title"></h2>
    <p class="dz-dialog-text"></p>
    <details class="dz-dialog-details"><summary>What will be saved</summary><pre class="dz-dialog-record"></pre></details>
    <p class="dz-dialog-status" aria-live="polite"></p>
    <div class="dz-dialog-actions">
      <button type="button" class="dz-dialog-yes">Save</button>
      <button type="button" class="dz-dialog-no quiet">Not now</button>
    </div>
  </div>
</div>

<details class="dz-log"><summary>What passes between the pages</summary><ol></ol></details>
<p class="dz-foot">A testing page (Daisy build step 7: the bot). Each player's page runs its own copy of the house, and the dice come from both players together, so neither can choose them. Drag your die to turn it, scroll or pinch to zoom: the other player sees it move. A saved match can be re-checked from its record alone.</p>
`;
