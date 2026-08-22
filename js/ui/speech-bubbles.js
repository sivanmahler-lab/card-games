/* =============================================================================================
   SPEECH BUBBLES — js/ui/speech-bubbles.js
   =============================================================================================
   Small, ephemeral speech bubbles anchored to a bot's name badge, driven by the persona's
   speechStyle (see js/ai/bot-persona.js). Two distinct things this module renders:

     1. A "thinking..." bubble shown WHILE a bot is deciding (bidding or playing), removed the
        moment the real action happens. This is deliberately generic per archetype ("רגע
        לחשוב..." for conservative vs "למה לחכות?" for aggressive) rather than per-event, since
        it's shown before the outcome of the decision is known.
     2. A short reaction bubble shown AFTER an event whose outcome is known (won a trick, missed
        a bid), picked at random from that archetype's line bank so the same bot doesn't repeat
        itself every round.

   This module does no game-logic decisions and does not read/write S — whist.html calls these
   functions at the exact points it already has a human-perceptible delay (the existing
   scheduleTurnAction(...) delays for bidding/playing) or a resolved outcome (finishTrick,
   finishRound), passing in the seat's DOM badge id and bot name it already has on hand.
   ============================================================================================= */

import { speechStyleFor } from '../ai/bot-persona.js';

// ---- Line bank -------------------------------------------------------------------------------
// Keyed by speechStyle (not by bot name) so a future 4th/5th archetype only needs one new entry
// here, reused by any bot assigned that style.
const SPEECH_BANK = Object.freeze({
  understated: {
    thinking:     ['רגע לחשוב...', 'הממ...'],
    onWinTrick:   ['כצפוי.', 'טוב, טוב.'],
    onMissedBid:  ['חבל.', 'לא נורא, בפעם הבאה.'],
    onBidPressure:['רגע לחשוב...'],
  },
  boastful: {
    thinking:     ['למה לחכות?', 'קל קל...'],
    onWinTrick:   ['בדיוק ככה!', 'מי עוד?'],
    onMissedBid:  ['זה לא הוגן!', 'בפעם הבאה אני הולך על הכל.'],
    onBidPressure:['למה לחכות?'],
  },
  analytical: {
    thinking:     ['בודקת את הקלפים...', 'מחשבת...'],
    onWinTrick:   ['כמו שחישבתי.', 'בדיוק לפי התכנון.'],
    onMissedBid:  ['מוזר, החישוב היה נכון.', 'משתנה בלתי צפוי.'],
    onBidPressure:['בודקת את הקלפים שוב...'],
  },
  neutral: {
    thinking:     ['רגע...'],
    onWinTrick:   ['יש!'],
    onMissedBid:  ['אה, חבל.'],
    onBidPressure:['רגע...'],
  },
});

function linesFor(name, kind){
  const style = speechStyleFor(name);
  const bank = SPEECH_BANK[style] || SPEECH_BANK.neutral;
  return bank[kind] || SPEECH_BANK.neutral[kind] || [];
}

function pickLine(name, kind){
  const lines = linesFor(name, kind);
  if(lines.length === 0) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

// ---- Bubble rendering -------------------------------------------------------------------------
// One live bubble per badge at a time — a new call replaces whatever bubble that badge was
// already showing rather than stacking multiple, since a bot never needs to say two things at
// once and stacked bubbles would drift out of sync with delays already in flight.
const activeBubbles = new Map(); // badgeId -> {el, timeoutId}

function ensureStyles(){
  if(document.getElementById('speech-bubble-styles')) return;
  const style = document.createElement('style');
  style.id = 'speech-bubble-styles';
  style.textContent = `
    .speech-bubble{
      position:absolute; bottom:calc(100% + 8px); left:50%; transform:translateX(-50%) translateY(4px) scale(.92);
      background:rgba(10,20,16,.92); border:1px solid var(--gold-bright, #f0d896); color:var(--cream,#faf4e6);
      font-size:11.5px; font-weight:600; white-space:nowrap; padding:5px 11px; border-radius:12px;
      box-shadow:0 6px 18px rgba(0,0,0,.35); pointer-events:none; z-index:40;
      opacity:0; transition:opacity .18s ease-out, transform .18s ease-out;
    }
    .speech-bubble.show{ opacity:1; transform:translateX(-50%) translateY(0) scale(1); }
    .speech-bubble::after{
      content:''; position:absolute; top:100%; left:50%; transform:translateX(-50%);
      border:5px solid transparent; border-top-color:var(--gold-bright,#f0d896);
    }
    .speech-bubble.thinking{ font-style:italic; opacity:.9; }
    @media (prefers-reduced-motion: reduce){
      .speech-bubble{ transition:none; }
    }
  `;
  document.head.appendChild(style);
}

function clearBubble(badgeId){
  const existing = activeBubbles.get(badgeId);
  if(existing){
    clearTimeout(existing.timeoutId);
    existing.el.remove();
    activeBubbles.delete(badgeId);
  }
}

/**
 * Show a bubble anchored to the given badge element id (e.g. 'badge-2', matching whist.html's
 * existing badge-{displaySeat} ids so this always anchors to the correct rotated seat).
 *
 * @param {string} badgeId - DOM id of the name-badge element to anchor to
 * @param {string} text - bubble text
 * @param {object} [opts]
 * @param {boolean} [opts.isThinking] - adds the 'thinking' style (italic, slightly dimmer)
 * @param {number} [opts.durationMs] - auto-remove after this long (default 1600ms)
 */
export function showBubble(badgeId, text, opts = {}){
  if(!text) return;
  ensureStyles();
  const badge = document.getElementById(badgeId);
  if(!badge) return;
  clearBubble(badgeId);
  // The badge needs a positioning context for the bubble's `position:absolute` to anchor to it
  // rather than to the nearest other positioned ancestor (e.g. #felt).
  if(getComputedStyle(badge).position === 'static') badge.style.position = 'relative';
  const el = document.createElement('div');
  el.className = 'speech-bubble' + (opts.isThinking ? ' thinking' : '');
  el.textContent = text;
  badge.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const duration = opts.durationMs || 1600;
  const timeoutId = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
    activeBubbles.delete(badgeId);
  }, duration);
  activeBubbles.set(badgeId, { el, timeoutId });
}

/** Immediately hide whatever bubble a badge is currently showing (e.g. once the real action lands). */
export function hideBubble(badgeId){
  clearBubble(badgeId);
}

/**
 * Show a "thinking..." bubble for a bot, styled by its persona's speechStyle. Call this right
 * when you schedule the bot's delayed action (e.g. inside the same scheduleTurnAction call
 * whist.html already uses for botTrumpBid/botDeclare/botPlay), and call hideBubble() (or just
 * let it auto-expire) once the action actually resolves.
 *
 * @param {string} badgeId
 * @param {string} name - bot display name (used to look up its persona's speech style)
 * @param {number} [thinkDurationMs] - how long the bot's actual delay is, so the bubble doesn't
 *   auto-hide before the action lands. Defaults to 1200ms.
 */
export function showThinkingBubble(badgeId, name, thinkDurationMs = 1200){
  const line = pickLine(name, 'thinking');
  showBubble(badgeId, line, { isThinking: true, durationMs: thinkDurationMs });
}

/**
 * Show a short reaction bubble for a resolved event (won a trick / missed a bid). Picks a
 * random line from that bot's archetype's bank so the same bot doesn't repeat itself constantly.
 *
 * @param {string} badgeId
 * @param {string} name - bot display name
 * @param {'onWinTrick'|'onMissedBid'|'onBidPressure'} kind
 */
export function showReactionBubble(badgeId, name, kind){
  const line = pickLine(name, kind);
  showBubble(badgeId, line, { durationMs: 1800 });
}

