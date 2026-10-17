// The table page's markup. Kept in one place (not in the .astro file) so the browser checks use
// exactly what the page uses. Static text only; anything from the network goes in with textContent.
import { BOT } from './config.js';

// A small outline robot after the bot's handle (our own drawing), and words for screen readers.
const ROBOT = `<svg class="su-robot" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="12" y1="2.5" x2="12" y2="5.5"/><circle cx="12" cy="2.3" r="0.6" fill="currentColor"/><rect x="4.5" y="6" width="15" height="12" rx="3.5"/><circle cx="9.3" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.7" cy="12" r="1.3" fill="currentColor" stroke="none"/><line x1="2.5" y1="11" x2="2.5" y2="13.5"/><line x1="21.5" y1="11" x2="21.5" y2="13.5"/></svg><span class="su-sr"> (a bot)</span>`;

const seat = (n) => `
  <section class="su-seat" data-seat="${n}" aria-label="Seat ${n}">
    <form class="su-sit" autocomplete="off">
      <label for="su-handle-${n}">Seat ${n}</label>
      <input id="su-handle-${n}" name="handle" value="" spellcheck="false" autocapitalize="off" placeholder="yourhandle.bsky.social">
      <button type="submit" class="su-sit-go">Sign in and sit</button>
      ${n === 2 ? `<button type="button" class="su-bot su-quiet">Play against @${BOT.handle} ${ROBOT}</button>` : ''}
    </form>
    <div class="su-seat-line">
      <p class="su-seat-state" aria-live="polite"></p>
      <button type="button" class="su-cancel su-quiet" hidden>Cancel</button>
      <button type="button" class="su-again" hidden>Sign in again</button>
    </div>
    <div class="su-frame">
      <div class="su-mount"></div>
      <div class="su-status" hidden><p></p><button type="button" class="su-retry" hidden>Try again</button></div>
    </div>
  </section>`;

export const MARKUP = `
  <header class="su-bar">
    <div class="su-title"><h1>Seven-Up</h1><span class="su-tag">a dice table made of web tiles · lab</span></div>
    <div class="su-resume" hidden>
      <span class="su-resume-text"></span>
      <button type="button" class="su-resume-yes">Resume</button>
      <button type="button" class="su-resume-no su-quiet">Start fresh</button>
    </div>
  </header>
  <p class="su-intro">Two players take turns rolling two dice until a 7, three rounds each. A hidden third tile, the house, rolls the dice and keeps the score. On your own? Play against @${BOT.handle}, the table's bot.</p>
  <p class="su-intro su-small">Signing in at a seat lets this page save your finished matches to your account, as Seven-Up match records (<code>cafe.thunderbird.sevenup.match</code>), and nothing else. Saving is always your choice, match by match.</p>
  <div class="su-table-note" hidden><p></p><button type="button" class="su-table-retry" hidden>Try again</button></div>
  <main class="su-seats">${seat(1)}${seat(2)}</main>
  <div class="su-house" hidden>
    <div class="su-house-box" role="dialog" aria-label="The whole table">
      <button type="button" class="su-house-close">Close</button>
      <div class="su-house-mount"></div>
    </div>
  </div>
  <div class="su-dialog" hidden>
    <div class="su-dialog-box" role="dialog" aria-modal="true" aria-labelledby="su-dialog-title">
      <h2 id="su-dialog-title"></h2>
      <p class="su-dialog-text"></p>
      <details class="su-dialog-details"><summary>What will be saved</summary><pre class="su-dialog-record"></pre></details>
      <p class="su-dialog-status" aria-live="polite"></p>
      <div class="su-dialog-actions">
        <button type="button" class="su-dialog-yes">Save</button>
        <button type="button" class="su-dialog-no su-quiet">Not now</button>
      </div>
    </div>
  </div>
  <details class="su-log">
    <summary>What the page passes between the tiles <span class="su-log-count"></span></summary>
    <ol></ol>
  </details>`;
