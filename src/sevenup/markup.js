// The table page's markup. Kept in one place (not in the .astro file) so the browser checks use
// exactly what the page uses. Static text only; anything from the network goes in with textContent.
import { ACCOUNTS, BOT } from './config.js';

const handles = Object.values(ACCOUNTS);

const seat = (n) => `
  <section class="su-seat" data-seat="${n}" aria-label="Seat ${n}">
    <form class="su-sit" autocomplete="off">
      <label for="su-handle-${n}">Seat ${n}</label>
      <input id="su-handle-${n}" name="handle" value="${handles[n - 1] || ''}" spellcheck="false" autocapitalize="off" placeholder="yourhandle.bsky.social">
      <button type="submit" class="su-sit-go">Sign in and sit</button>
      ${n === 2 ? `<button type="button" class="su-bot su-quiet">Play against @${BOT.handle}</button>` : ''}
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
