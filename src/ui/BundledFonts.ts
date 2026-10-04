// The two typefaces of LEGACY §4, bundled with the game (no CDN, phase 18 named them with system fallbacks only).
// Each weight's stylesheet declares every subset with its unicode-range, so the browser fetches only latin and
// latin-ext (Czech diacritics). Weights are the ones the DOM UI uses (HUD, quiz, menu, screens).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";

/** Family names declared by the bundled stylesheets (data/*.json font stacks start with them). */
export const BUNDLED_FONT_FAMILIES = ["Barlow Condensed", "Inter"] as const;
