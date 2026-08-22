/* =============================================================================================
   BOT PERSONA ENGINE — js/ai/bot-persona.js
   =============================================================================================
   Hidden per-bot personality parameters that shape HOW each bot bids and plays, sitting on
   top of the existing safe-tricks bidding logic and the persisted bot-learning multiplier
   (see whist.html's botAggressiveness/recordBotBidOutcome). Nothing here replaces that
   engine — it only nudges its inputs and outputs per-bot, so the underlying strategy (safe-
   trick counting, position-aware declarations, UP/UNDER opening-lead logic) stays exactly as
   already tuned and verified.

   Design intent (see docs/premium-platform-proposal.md §3 for the full rationale):
     - The bot's NAME never reveals its archetype. "צ'רצ'יל"/"ארתור"/"ויקטוריה" are just
       names in the UI; riskTolerance/bidShading/etc. are never surfaced anywhere.
     - riskTolerance multiplies the same safe-tricks estimate the engine already computes —
       a conservative bot needs a *higher* bar before it counts a card as "safe", an
       aggressive bot needs a *lower* one. This is why riskTolerance multiplies the estimate
       directly rather than being yet another independent scoring system.
     - bidShading is a flat nudge applied to the final rounded bid, AFTER the safe-tricks
       estimate and the learned multiplier already did their work — a small, constant "this
       bot tends to lean up/down" thumb on the scale, independent of hand strength.
     - riskAversionToZero scales how "eager" hasOnlyLowCardsEverySuit-style zero-bid checks
       are to actually trigger — see shouldConsiderZeroBid() below.
     - countingAccuracy feeds card-counting confidence (used by the opening-lead / follow-suit
       logic to decide whether a bot "reliably knows" a suit's Ace has already fallen). A
       lower accuracy sometimes makes the bot ignore information it technically could have
       inferred, precisely to simulate a less careful player rather than an omniscient one.

   IMPORTANT: this module is loaded as an ES module (`<script type="module">`) directly from
   whist.html. It exports plain functions — it does not read or mutate the game's global `S`
   state itself, to keep it testable/reusable independent of the DOM and game loop. whist.html
   passes in whatever it already has (hand, mult, etc.) and uses the returned numbers exactly
   where the old inline logic used to compute them directly.
   ============================================================================================= */

// ---- Persona table -------------------------------------------------------------------------
// NOTE: keys are the exact display names used in BOT_NAMES / S.names in whist.html. A bot name
// with no matching entry here falls back to NEUTRAL_PERSONA (see getPersona()) rather than
// throwing, so adding a new bot name to the roster without a persona entry never breaks a game.
export const BOT_PERSONAS = Object.freeze({
  "צ'רצ'יל": Object.freeze({
    archetype: 'conservative',
    riskTolerance: 0.75,       // demands more safety margin before counting a card "safe"
    bidShading: -0.5,          // nudges final bids slightly under the raw estimate
    riskAversionToZero: 1.3,   // more willing to bid zero on a borderline-weak hand
    countingAccuracy: 0.85,    // reliably tracks which high cards have already fallen
    speechStyle: 'understated',
  }),
  'ארתור': Object.freeze({
    archetype: 'aggressive',
    riskTolerance: 1.25,       // counts cards as "safe" more readily — plays on nerve
    bidShading: 0.75,          // nudges final bids slightly over the raw estimate
    riskAversionToZero: 0.6,   // very reluctant to ever bid zero
    countingAccuracy: 0.55,    // plays more "by feel" — less reliably tracks fallen cards
    speechStyle: 'boastful',
  }),
  'ויקטוריה': Object.freeze({
    archetype: 'precise-counter',
    riskTolerance: 1.0,        // neutral — her edge comes from information, not risk appetite
    bidShading: 0,             // bids exactly what she calculates, no directional lean
    riskAversionToZero: 1.0,   // neutral
    countingAccuracy: 0.98,    // almost never misjudges which cards have already fallen
    speechStyle: 'analytical',
  }),
});

// A 4th bot name (אליזבט) already exists in BOT_NAMES for 4-human-seat-minus-one situations
// but has no distinct archetype defined yet — it plays with the neutral persona below rather
// than being silently mapped onto one of the three real personas above.
const NEUTRAL_PERSONA = Object.freeze({
  archetype: 'neutral',
  riskTolerance: 1.0,
  bidShading: 0,
  riskAversionToZero: 1.0,
  countingAccuracy: 0.8,
  speechStyle: 'neutral',
});

/** Look up a bot's persona by its display name. Never throws; always returns an object. */
export function getPersona(name){
  return BOT_PERSONAS[name] || NEUTRAL_PERSONA;
}

// ---- Bidding integration ---------------------------------------------------------------------

/**
 * Combined bidding multiplier for a bot: persona riskTolerance × the existing persisted
 * learning multiplier (botAggressiveness from whist.html). Callers should use THIS instead of
 * the learning multiplier alone wherever the old code did `estimateTricks(...) * mult` or
 * `safeTricksIfTrump(...) * mult`.
 *
 * @param {string} name - bot display name (e.g. S.names[p])
 * @param {number} learnedMult - the existing botAggressiveness(name) value from whist.html
 */
export function biddingMultiplier(name, learnedMult){
  const persona = getPersona(name);
  return persona.riskTolerance * (typeof learnedMult === 'number' ? learnedMult : 1);
}

/**
 * Apply the persona's constant directional lean to a bid AFTER it has already been computed
 * and rounded by the existing estimate-based logic, then re-clamp to [0,13]. This is a small,
 * hand-independent nudge — it does not replace the existing zero-bid / 13-closing heuristics,
 * it just shifts the final number a notch in the bot's characteristic direction.
 *
 * @param {number} roundedBid - the bid value botDeclare() already computed via its existing logic
 * @param {string} name - bot display name
 * @param {number} minBid - the floor this bid must respect (e.g. the trump-winner's committed count, or 0)
 */
export function applyBidShading(roundedBid, name, minBid = 0){
  const persona = getPersona(name);
  if(persona.bidShading === 0) return roundedBid;
  const shaded = Math.round(roundedBid + persona.bidShading);
  return Math.max(minBid, Math.min(13, shaded));
}

/**
 * Whether a borderline "every suit only has low cards" hand should actually be bid as zero,
 * given this bot's temperament. The existing hasOnlyLowCardsEverySuit(hand) check in whist.html
 * already decides whether the hand QUALIFIES as zero-bid-worthy; this function decides whether
 * THIS bot, with its risk appetite, actually pulls the trigger on that borderline call.
 *
 * A conservative bot (riskAversionToZero > 1) takes the zero bid essentially every time it
 * qualifies. An aggressive bot (riskAversionToZero < 1) sometimes talks itself out of it even
 * when the hand technically qualifies, because it doesn't like committing to zero.
 *
 * @param {boolean} qualifiesForZero - result of hasOnlyLowCardsEverySuit(hand) (or equivalent)
 * @param {string} name - bot display name
 * @param {() => number} rng - optional injectable RNG for deterministic testing; defaults to Math.random
 */
export function shouldConsiderZeroBid(qualifiesForZero, name, rng = Math.random){
  if(!qualifiesForZero) return false;
  const persona = getPersona(name);
  // riskAversionToZero acts as a direct probability multiplier on an already-qualifying hand:
  // 1.3 → 100% chance (clamped), 0.6 → 60% chance, 1.0 → 100% chance (neutral bots always take
  // a hand that already qualifies — the discretion is specifically an aggressive-bot trait).
  const chance = Math.min(1, persona.riskAversionToZero);
  return rng() < chance;
}

// ---- Card-counting integration -----------------------------------------------------------------

/**
 * Whether this bot "reliably knows" that a suit's top card above `aboveRank` has already been
 * played this round, given its countingAccuracy. whist.html's existing suitTopIsGone(suit,
 * aboveRank) closure already computes the OBJECTIVE fact (has it actually fallen); this
 * function decides whether THIS bot's memory can be trusted to have noticed, so a low-
 * countingAccuracy bot sometimes misses information a careful player would have used (e.g.
 * leading a King as if it were still second-best, when the Ace already fell three tricks ago).
 *
 * @param {boolean} objectivelyGone - result of the existing suitTopIsGone(...) check
 * @param {string} name - bot display name
 * @param {() => number} rng - optional injectable RNG for deterministic testing
 */
export function knowsSuitTopIsGone(objectivelyGone, name, rng = Math.random){
  if(!objectivelyGone) return false;
  const persona = getPersona(name);
  return rng() < persona.countingAccuracy;
}

// ---- Speech-style lookup (consumed by js/ui/speech-bubbles.js) --------------------------------

/** Convenience accessor so speech-bubbles.js doesn't need its own copy of the persona table. */
export function speechStyleFor(name){
  return getPersona(name).speechStyle;
}

