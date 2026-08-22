/* =============================================================================================
   SPEECH BUBBLES — js/ui/speech-bubbles.js
   =============================================================================================
   Small, ephemeral speech bubbles anchored to a bot's name badge, driven by the persona's
   speechStyle (see js/ai/bot-persona.js). Deliberately restrained by design: bots stay quiet
   almost all the time and only speak up for a genuinely dramatic, unusual moment in the hand —
   this is a premium accent, not a running commentary track, and it should never read as spam.

   Design intent, per explicit product direction:
     - NO "thinking..." bubble while a bot is deciding. A bot's decision delay is just a plain,
       silent pause now — nothing is shown during it. (showThinkingBubble is kept as a no-op
       shim below so whist.html's existing call sites don't need to change; see the note there.)
     - Reactions are gated to three specific dramatic triggers, decided by whist.html (this
       module has no access to game state and makes no game-logic judgment calls):
         1. onZeroBid   — this bot just declared a bid of exactly zero (a rare, high-risk call).
         2. onBadMiss   — this bot missed its bid by 2 or more tricks in either direction.
         3. onSurpriseWin — this bot won a trick it didn't need (it had already made its bid),
            an unwanted extra that risks blowing a made contract.
       whist.html only calls showReactionBubble() when one of these three conditions is actually
       true — this module doesn't re-derive them.
     - Even when a trigger fires, the bubble only actually shows ~30-40% of the time (see
       REACTION_CHANCE below) — a bot that reacted to every single dramatic moment would still
       feel like too much. Missing the roll is silent: no bubble, no fallback line.
     - Lines are short, dry, and specific to each archetype's voice: צ'רצ'יל understated and
       wry, ארתור brash and a little too confident, ויקטוריה clipped and numeric. No archetype
       repeats a line back-to-back for the same bot instance in a single game session (see the
       last-line tracking below) so a long game doesn't start feeling canned.

   This module does no game-logic decisions and does not read/write S — whist.html decides WHEN
   a trigger condition is true and calls showReactionBubble() only then, passing in the seat's
   DOM badge id, the bot's display name, and which of the three trigger kinds fired.
   ============================================================================================= */

import { speechStyleFor } from '../ai/bot-persona.js';

// Only this fraction of genuinely-triggered dramatic moments actually produce a bubble. Kept
// module-private (not exported) so the "how often do bots talk" tuning lives in exactly one
// place; whist.html doesn't need to know this number, it just calls showReactionBubble() on
// every real trigger and lets this module decide whether to actually show anything.
const REACTION_CHANCE = 0.35;

// ---- Line bank -------------------------------------------------------------------------------
// Keyed by speechStyle (not by bot name) so a future 4th/5th archetype only needs one new entry
// here, reused by any bot assigned that style. Every line bank below covers exactly the three
// dramatic trigger kinds whist.html can fire — no generic "thinking"/"bid pressure" filler.
const SPEECH_BANK = Object.freeze({
  understated: { // צ'רצ'יל — measured, dry, never raises his voice
    onZeroBid:     ['אפס. שקט לפני הסערה.', 'לפעמים לא לקחת הוא הניצחון.', 'אפס — ונחיה עם זה.'],
    onBadMiss:     ['טעות חישוב. תקרה.', 'הפעם לא הלך. לומדים.', 'מסקנות מהסיבוב הזה — בשקט.'],
    onSurpriseWin: ['לא ביקשתי את זה.', 'לקיחה מיותרת. חבל.', 'טוב שהצלחתי — פחות טוב שהייתי צריך.'],
  },
  boastful: { // ארתור — loud, sure of himself, a little too sure
    onZeroBid:     ['אפס?! לא הימור שלי בד"כ.', 'אפס, אבל תסתכלו בסיבוב הבא.', 'גם אפס אני עושה בסטייל.'],
    onBadMiss:     ['זה לא ייתכן.', 'המזל בגד בי, לא האסטרטגיה.', 'בפעם הבאה — בלי רחמים.'],
    onSurpriseWin: ['אמרתי לכם!', 'קלף שלא תכננתי — אבל אני אקח אותו.', 'זה מה שקורה כשאני משחק.'],
  },
  analytical: { // ויקטוריה — clipped, numeric, states outcomes as facts
    onZeroBid:     ['אפס. חישוב מדויק.', 'הסתברות גבוהה, הימור אפס.', 'אפס לקיחות — כמתוכנן.'],
    onBadMiss:     ['סטייה של שתיים ומעלה מהתחזית.', 'משתנה לא צפוי בחישוב.', 'התחזית לא התממשה הפעם.'],
    onSurpriseWin: ['לקיחה נוספת, לא בתכנון.', 'עודף לא רצוי.', 'תוצאה שלא נדרשה.'],
  },
  neutral: { // אליזבט / any future bot without a defined archetype
    onZeroBid:     ['אפס.', 'הולכת על אפס.'],
    onBadMiss:     ['לא הלך הפעם.', 'טעיתי בהערכה.'],
    onSurpriseWin: ['לא ציפיתי לזו.', 'לקיחה בלתי צפויה.'],
  },
});

// Tracks the last line shown per (badgeId+kind) so the same bot doesn't repeat itself back-to-
// back — a small in-memory map, intentionally not persisted, since "don't repeat within this
// game session" is all the polish this needs.
const lastLineShown = new Map(); // key: `${name}:${kind}` -> line string

function linesFor(name, kind){
  const style = speechStyleFor(name);
  const bank = SPEECH_BANK[style] || SPEECH_BANK.neutral;
  return bank[kind] || SPEECH_BANK.neutral[kind] || [];
}

function pickLine(name, kind){
  const lines = linesFor(name, kind);
  if(lines.length === 0) return null;
  if(lines.length === 1) return lines[0];
  const key = name + ':' + kind;
  const last = lastLineShown.get(key);
  let candidates = lines;
  if(last){
    const filtered = lines.filter(l => l !== last);
    if(filtered.length > 0) candidates = filtered;
  }
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  lastLineShown.set(key, chosen);
  return chosen;
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
    /* z-index is deliberately far above every other table element (trick-winner announcement
       at 100, declare-summary modal at 120, the bottom seat itself at 60, etc.) — a bubble is
       a small, short-lived, high-priority interruption and must never be buried behind any of
       those, regardless of which seat (bottom/top/left/right) it's anchored to. */
    .speech-bubble{
      position:absolute; bottom:calc(100% + 10px); left:50%; transform:translateX(-50%) translateY(4px) scale(.9);
      background:#0a1410; border:2px solid var(--gold-bright, #f0d896); color:var(--cream,#faf4e6);
      font-size:12px; font-weight:700; white-space:nowrap; padding:6px 13px; border-radius:13px;
      box-shadow:0 8px 22px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.3); pointer-events:none; z-index:9999;
      opacity:0; transition:opacity .18s ease-out, transform .18s ease-out;
    }
    .speech-bubble.show{ opacity:1; transform:translateX(-50%) translateY(0) scale(1); }
    .speech-bubble::after{
      content:''; position:absolute; top:100%; left:50%; transform:translateX(-50%);
      border:6px solid transparent; border-top-color:var(--gold-bright,#f0d896);
    }
    .speech-bubble::before{
      /* Inner triangle, 1px smaller and inset by the border width, so the arrow's fill color
         matches the bubble's own dark background instead of showing only a solid gold wedge. */
      content:''; position:absolute; top:calc(100% - 2px); left:50%; transform:translateX(-50%);
      border:5px solid transparent; border-top-color:#0a1410; z-index:1;
    }
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
 * @param {number} [opts.durationMs] - auto-remove after this long (default 1800ms)
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
  el.className = 'speech-bubble';
  el.textContent = text;
  badge.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const duration = opts.durationMs || 1800;
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
 * No-op kept only so whist.html's existing scheduleTurnAction call sites (which call this right
 * before a bot's bidding/playing delay) don't need to be touched. Per the current design, bots
 * are silent while deciding — no "thinking..." bubble is shown here anymore. If whist.html is
 * ever updated to drop these call sites entirely, this export can be removed too.
 */
export function showThinkingBubble(){
  // Intentionally does nothing.
}

/**
 * Show a short reaction bubble for a genuinely dramatic, resolved moment. whist.html is
 * responsible for only calling this when one of the three trigger kinds below is actually true
 * — this module does not re-derive or validate that from game state. Even when called, the
 * bubble only actually appears ~35% of the time (REACTION_CHANCE) so bots stay mostly quiet.
 *
 * @param {string} badgeId
 * @param {string} name - bot display name (used to look up its persona's speech style)
 * @param {'onZeroBid'|'onBadMiss'|'onSurpriseWin'} kind
 * @param {() => number} [rng] - optional injectable RNG for deterministic testing; defaults to Math.random
 */
export function showReactionBubble(badgeId, name, kind, rng = Math.random){
  if(rng() >= REACTION_CHANCE) return; // missed the roll — stay silent, no bubble at all
  const line = pickLine(name, kind);
  showBubble(badgeId, line, { durationMs: 2000 });
}

