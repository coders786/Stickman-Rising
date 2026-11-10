/** Dash stamina is separate from ability energy. Costs are charged on launch,
 * not on button down, so cancelled charges and failed requests are free.
 *
 * RECOVERY IS PHYSICAL (stillness law): a planted body recovers fastest —
 * holding the dash button plants the charge stance (the character is
 * logically STANDING), so a held charge RESTS the legs and the meter climbs
 * at the still rate. Walking/running recovers slower (active tissue); a full
 * sprint — the most expensive gait — recovers slowest. The post-dash regen
 * delay still applies on top: freshly spent legs don't refill instantly. */
export const DASH_STAMINA_MAX=600
export const DASH_STAMINA_COST=45
export const POWER_DASH_STAMINA_COST=120
/** planted / still (|vx| < 30, feet on the ground) — rest breath */
export const DASH_STAMINA_REGEN_STILL=110
/** walking / running — moving recovery */
export const DASH_STAMINA_REGEN=70
/** sprinting — heavy exertion, the meter barely trickles back */
export const DASH_STAMINA_REGEN_SPRINT=42
export const DASH_STAMINA_REGEN_DELAY=.9
