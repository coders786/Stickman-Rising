/** STICKMAN RISING — the empty-hand contract constants.
 *
 * A LEAF MODULE, deliberately: it imports nothing.
 *
 * `attacks.ts` and `ronin.ts` already form an import cycle (attacks
 * registers RONIN_ATTACKS while ronin builds AttackDefs from attacks'
 * types). Putting a runtime constant in either end of that cycle means it
 * can be read before it is initialised, which throws
 * "Cannot access 'X' before initialization" at module-evaluation time —
 * the whole moveset table fails to build and every test file that touches
 * combat dies. A dependency-free module is the standard way out and is
 * how the bound is shared without adding to the cycle.
 */

/** Widest contact pad an EMPTY-HAND strike may use, in px.
 *
 * A blade is a plane and can justify a wider contact volume; a fist or a
 * heel is a point, so the empty-hand set must not inherit the sword's
 * radius. `moveset.ts` and `ronin.ts` both clamp against this, so no
 * future move can ship a punch with a katana's hitbox.
 *
 * See `tests/dual-stance.test.ts` — the contract is asserted, not assumed. */
export const EMPTY_HAND_PAD_MAX = 7
