// The Daisy page's markup (used by table.js and by the browser checks).
export const MARKUP = `
<header class="dz-head">
  <h1>Daisy <span aria-hidden="true">🌼</span></h1>
  <p class="dz-lede">A dice race for two players. One die: roll as often as you like, but a 1 loses the turn. Bank to keep your points. First to 25 wins.</p>
</header>

<section class="dz-lobby" aria-label="Join">
  <label class="dz-field">Your handle
    <input class="dz-handle" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="you.bsky.social">
  </label>
  <div class="dz-lobby-actions">
    <button class="dz-open" type="button">Open a table</button>
    <button class="dz-sit" type="button" hidden>Take a seat</button>
    <button class="dz-cancel quiet" type="button" hidden>Cancel</button>
  </div>
  <div class="dz-back" hidden></div>
  <p class="dz-lobby-note" aria-live="polite"></p>
  <p class="dz-lobby-hint">You sign in with your atproto account first (a small window opens), so the other player sees your real handle and you can save the match to your account. Signing in asks only to save Daisy matches.</p>
</section>

<p class="dz-account" hidden><span class="dz-account-text"></span>
  <button class="dz-signout dz-linkish" type="button" hidden>Sign out</button>
  <button class="dz-again dz-linkish" type="button" hidden>Sign in again</button></p>

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
  <div class="dz-house-note" hidden><p></p><button class="dz-house-retry quiet" type="button" hidden>Try again</button></div>
</section>

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
<p class="dz-foot">A testing page (Daisy build step 5: two computers through the relay). Each player's page runs its own copy of the house, and the dice come from both players together, so neither can choose them. Drag your die to turn it, scroll or pinch to zoom: the other player sees it move. A saved match can be re-checked from its record alone.</p>
`;
