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
      <button type="button" class="su-signout su-quiet" hidden>Sign out</button>
    </div>
    <div class="su-frame">
      <div class="su-mount"></div>
      <div class="su-status" hidden><p></p><button type="button" class="su-retry" hidden>Try again</button></div>
    </div>
  </section>`;

// The table embedded in a blog post (embed.js): you at seat 1, the bot at seat 2, no sign-in and no
// saving. The same frames, house view and message log as the full table.
const embedSeat = (n) => `
  <section class="su-seat" data-seat="${n}" aria-label="Seat ${n}">
    <div class="su-seat-line su-embed-line">
      <span class="su-embed-seat">Seat ${n}</span>
      <p class="su-seat-state">${n === 1 ? 'You' : `@${BOT.handle} ${ROBOT} · the bot`}</p>
    </div>
    <div class="su-frame">
      <div class="su-mount"></div>
      <div class="su-status"><p>Loading the tile…</p><button type="button" class="su-retry" hidden>Try again</button></div>
    </div>
  </section>`;

export const EMBED_MARKUP = (fullTable) => `
  <div class="su-table-note" hidden><p></p><button type="button" class="su-table-retry" hidden>Try again</button></div>
  <main class="su-seats">${embedSeat(1)}${embedSeat(2)}</main>
  <p class="su-embed-save" hidden>Matches here aren't saved. <a href="${fullTable}">Play the full table to save your match →</a></p>
  <div class="su-house" hidden>
    <div class="su-house-box" role="dialog" aria-label="The whole table">
      <button type="button" class="su-house-close">Close</button>
      <div class="su-house-mount"></div>
    </div>
  </div>
  <details class="su-log">
    <summary>What the page passes between the tiles <span class="su-log-count"></span></summary>
    <ol></ol>
  </details>`;

export const MARKUP = `
  <header class="su-bar">
  <div class="su-hero">
    <svg class="su-hero-glaze" viewBox="0 0 680 118" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><g stroke="rgba(80,110,90,0.12)" stroke-width="1" fill="none"><path d="M20 30 l40 18 l-12 30 l36 14"/><path d="M240 10 l-20 32 l30 22 l-8 40"/><path d="M430 100 l26 -30 l40 6 l12 -40"/><path d="M600 20 l-34 26 l22 30"/><path d="M130 100 l22 -26 l-14 -30"/></g></svg>
    <svg class="su-hero-dice" viewBox="340 0 340 118" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false"><g transform="rotate(14 420 40)"><rect x="404" y="24" width="32" height="32" rx="6" fill="#f4efe3" stroke="#c9bfa8" stroke-width="1.4"/><g fill="#1b1b1b"><circle cx="412.6" cy="32.6" r="2.7"/><circle cx="420.0" cy="40.0" r="2.7"/><circle cx="427.4" cy="47.4" r="2.7"/></g></g><g transform="rotate(-18 482 78)"><rect x="464" y="60" width="36" height="36" rx="7" fill="#c8262f" stroke="#8e1b22" stroke-width="1.4"/><g fill="#ffffff"><circle cx="473.7" cy="69.7" r="3.1"/><circle cx="490.3" cy="69.7" r="3.1"/><circle cx="473.7" cy="86.3" r="3.1"/><circle cx="490.3" cy="86.3" r="3.1"/></g></g><g transform="rotate(8 548 38)"><rect x="530" y="20" width="36" height="36" rx="7" fill="#1d2b4f" stroke="#0f1830" stroke-width="1.4"/><g fill="#e8c25a"><circle cx="539.7" cy="29.0" r="3.1"/><circle cx="556.3" cy="29.0" r="3.1"/><circle cx="539.7" cy="38.0" r="3.1"/><circle cx="556.3" cy="38.0" r="3.1"/><circle cx="539.7" cy="47.0" r="3.1"/><circle cx="556.3" cy="47.0" r="3.1"/></g></g><g transform="rotate(-6 610 82)"><rect x="592" y="64" width="36" height="36" rx="7" fill="#a8452f" stroke="#74301f" stroke-width="1.4"/><g fill="#f6ead2"><circle cx="601.7" cy="73.7" r="3.1"/><circle cx="618.3" cy="73.7" r="3.1"/><circle cx="610.0" cy="82.0" r="3.1"/><circle cx="601.7" cy="90.3" r="3.1"/><circle cx="618.3" cy="90.3" r="3.1"/></g></g><g transform="rotate(20 652 30)"><rect x="636" y="14" width="32" height="32" rx="6" fill="#b9d8c2" stroke="#86ad93" stroke-width="1.4"/><g fill="#24423a"><circle cx="644.6" cy="22.6" r="2.7"/><circle cx="659.4" cy="37.4" r="2.7"/></g></g><g transform="rotate(-12 360 88)"><rect x="344" y="72" width="32" height="32" rx="6" fill="#bfe6ff" stroke="#6fb8e8" stroke-width="1.4"/><g fill="#ffffff"><circle cx="352.6" cy="80.6" r="2.7"/><circle cx="367.4" cy="80.6" r="2.7"/><circle cx="360.0" cy="88.0" r="2.7"/><circle cx="352.6" cy="95.4" r="2.7"/><circle cx="367.4" cy="95.4" r="2.7"/></g></g></svg>
    <div class="su-title"><h1>Seven-Up</h1><span class="su-tag">a dice table made of web tiles · lab</span></div>
  </div>
    <div class="su-resume" hidden>
      <span class="su-resume-text"></span>
      <button type="button" class="su-resume-yes">Resume</button>
      <button type="button" class="su-resume-no su-quiet">Start fresh</button>
    </div>
  </header>
  <p class="su-intro">Two players take turns rolling two dice until a 7, three rounds each. A hidden third tile, the house, rolls the dice and keeps the score. On your own? Play against @${BOT.handle}, the table's bot. <a class="su-how" href="/blog/seven-up/">How this table works →</a></p>
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
