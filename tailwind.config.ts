import type { Config } from "tailwindcss";

// Arena Night tokens. Colours are CSS variables (RGB triplets in globals.css)
// so the same classes work in the dark default and the .light theme.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        sf: { DEFAULT: v("sf"), 2: v("sf2"), 3: v("sf3") },
        line: v("ln"),
        ink: { DEFAULT: v("ink"), 2: v("ink2"), 3: v("ink3") },
        accent: { DEFAULT: v("acc"), ink: "#16100A" },
        action: { DEFAULT: v("act"), ink: v("on-act") },
        you: { DEFAULT: v("you"), soft: "var(--you-s)" },
        opp: { DEFAULT: v("opp"), soft: "var(--opp-s)" },
        pending: { DEFAULT: v("pend"), soft: "var(--pend-s)" },
        recorded: { DEFAULT: v("rec"), soft: "var(--rec-s)" },
        mismatch: { DEFAULT: v("bad"), soft: "var(--bad-s)" },
        walnut: { 300: "#5A3622", 500: "#3B2316", 700: "#2A180E", pit: "#120A05" },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["56px", { lineHeight: "1", letterSpacing: "-0.05em", fontWeight: "600" }],
        h1: ["40px", { lineHeight: "1.02", letterSpacing: "-0.045em", fontWeight: "600" }],
        h2: ["26px", { lineHeight: "1.1", letterSpacing: "-0.04em", fontWeight: "600" }],
        body: ["15px", "1.45"],
        small: ["13px", "1.4"],
        eyebrow: ["11px", { letterSpacing: "0.08em" }],
      },
      borderRadius: { chip: "999px", key: "18px", card: "22px", game: "26px", sheet: "30px", board: "30px" },
      boxShadow: {
        float: "var(--sh)",
        edge: "inset 0 0 0 1px var(--edge)",
        pit: "inset 0 4px 10px rgb(0 0 0 / .75)",
        legal: "0 0 0 2px #F3B542, 0 0 22px rgb(243 181 66 / .35)",
      },
      transitionTimingFunction: { out: "cubic-bezier(.2,.8,.2,1)", spring: "cubic-bezier(.34,1.56,.64,1)" },
      keyframes: {
        pop: { from: { transform: "scale(.6)", opacity: "0" } },
        slide: { from: { transform: "translateY(100%)", opacity: "0" } },
        drop: { from: { transform: "translateY(-10px)", opacity: "0" } },
        shake: {
          "0%,100%": { transform: "none" },
          "20%": { transform: "translateX(-6px)" },
          "40%": { transform: "translateX(6px)" },
          "60%": { transform: "translateX(-6px)" },
          "80%": { transform: "translateX(4px)" },
        },
        flip: { from: { transform: "perspective(400px) rotateY(90deg)", opacity: ".3" } },
        floatup: {
          from: { transform: "translate(-50%,20px) scale(.6)", opacity: "0" },
          "20%": { opacity: "1", transform: "translate(-50%,0) scale(1.1)" },
          to: { transform: "translate(-50%,-140px) scale(1)", opacity: "0" },
        },
        ripple: { "0%": { transform: "scale(.45)", opacity: ".9" }, "100%": { transform: "scale(1.25)", opacity: "0" } },
        bob: { "50%": { transform: "translateY(-6px)" } },
        shimmer: { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(100%)" } },
        pulse: { "50%": { opacity: ".75" } },
        flash: { "50%": { boxShadow: "0 0 0 4px #F3B542, 0 0 34px rgb(243 181 66 / .8)" } },
      },
      animation: {
        pop: "pop .16s cubic-bezier(.34,1.56,.64,1)",
        slide: "slide .24s cubic-bezier(.2,.8,.2,1)",
        drop: "drop .3s cubic-bezier(.2,.8,.2,1)",
        shake: "shake .3s ease-in-out",
        flip: "flip .42s cubic-bezier(.2,.8,.2,1) both",
        floatup: "floatup 1.4s ease-out forwards",
        ripple: "ripple 1.6s ease-out infinite",
        bob: "bob 2.4s ease-in-out infinite",
        shimmer: "shimmer 1.4s linear infinite",
        urgent: "pulse 1s ease-in-out infinite",
        flash: "flash .3s ease-in-out 2",
        callout: "pop .38s cubic-bezier(.34,1.56,.64,1)",
      },
    },
  },
  plugins: [],
};

export default config;
