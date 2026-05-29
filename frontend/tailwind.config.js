/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        void:    "#050911",
        base:    "#080E1A",
        surface: "#0C1522",
        panel:   "#101A28",
        rim:     "#182233",
        gold: {
          DEFAULT: "#C4993B",
          bright:  "#DDB84A",
          dim:     "#7A5F22",
          faint:   "#C4993B12",
          border:  "#C4993B35",
          glow:    "#C4993B40",
        },
        teal: {
          DEFAULT: "#2EC4B6",
          dim:     "#1A7A70",
          faint:   "#2EC4B612",
          glow:    "#2EC4B640",
        },
        crimson: "#C44040",
        wire:    "#1A2535",
        ink: {
          primary:   "#DDD5C4",
          secondary: "#8A9BB0",
          dim:       "#4A5568",
        },
      },
      fontFamily: {
        display: ["'Bebas Neue'", "sans-serif"],
        body:    ["'Outfit'", "sans-serif"],
        mono:    ["'JetBrains Mono'", "monospace"],
      },
      letterSpacing: {
        widest2: "0.2em",
        widest3: "0.3em",
      },
      boxShadow: {
        "glow-gold":    "0 0 24px rgba(196,153,59,0.3), 0 0 60px rgba(196,153,59,0.12)",
        "glow-gold-sm": "0 0 12px rgba(196,153,59,0.25)",
        "glow-teal":    "0 0 24px rgba(46,196,182,0.3), 0 0 60px rgba(46,196,182,0.12)",
        "glow-teal-sm": "0 0 12px rgba(46,196,182,0.25)",
        "glow-crimson": "0 0 24px rgba(196,64,64,0.3)",
        "card-lift":    "0 12px 40px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
        "card-live":    "0 0 0 1px rgba(196,153,59,0.2), 0 0 40px rgba(196,153,59,0.06), 0 12px 40px rgba(0,0,0,0.4)",
        "card-revealed":"0 0 0 1px rgba(46,196,182,0.2), 0 0 40px rgba(46,196,182,0.06), 0 12px 40px rgba(0,0,0,0.4)",
        "inset-gold":   "inset 0 0 60px rgba(196,153,59,0.04)",
        "inset-teal":   "inset 0 0 60px rgba(46,196,182,0.04)",
      },
      animation: {
        "pulse-gold":    "pulse-gold 2s ease-in-out infinite",
        "reveal-bar":    "reveal-bar 0.8s cubic-bezier(0.16,1,0.3,1) forwards",
        "flicker":       "flicker 0.15s ease-out",
        "stripe-drift":  "stripe-drift 4s linear infinite",
        "glow-breathe":  "glow-breathe 3s ease-in-out infinite",
        "ring-expand":   "ring-expand 2s ease-out infinite",
        "ring-expand-2": "ring-expand 2s ease-out 0.7s infinite",
        "scan-right":    "scan-right 2.5s cubic-bezier(0.4,0,0.6,1) infinite",
        "data-in":       "data-in 0.5s cubic-bezier(0.16,1,0.3,1) forwards",
        "count-flip":    "count-flip 0.12s ease-out",
        "slide-up":      "slide-up 0.6s cubic-bezier(0.16,1,0.3,1) forwards",
        "line-fill":     "line-fill 0.8s cubic-bezier(0.16,1,0.3,1) forwards",
      },
      keyframes: {
        "pulse-gold": {
          "0%,100%": { opacity: "1" },
          "50%":     { opacity: "0.4" },
        },
        "reveal-bar": {
          "0%":   { width: "0%", opacity: "0" },
          "100%": { opacity: "1" },
        },
        "flicker": {
          "0%":   { opacity: "0.6" },
          "50%":  { opacity: "1" },
          "100%": { opacity: "0.8" },
        },
        "stripe-drift": {
          "0%":   { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "28px 0" },
        },
        "glow-breathe": {
          "0%,100%": { opacity: "0.5" },
          "50%":     { opacity: "1" },
        },
        "ring-expand": {
          "0%":   { transform: "scale(1)", opacity: "0.7" },
          "100%": { transform: "scale(2.8)", opacity: "0" },
        },
        "scan-right": {
          "0%":   { transform: "translateX(-100%)", opacity: "0" },
          "10%":  { opacity: "1" },
          "90%":  { opacity: "1" },
          "100%": { transform: "translateX(100%)", opacity: "0" },
        },
        "data-in": {
          "0%":   { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "count-flip": {
          "0%":   { transform: "translateY(-4px)", opacity: "0.3" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "slide-up": {
          "0%":   { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "line-fill": {
          "0%":   { scaleY: "0", transformOrigin: "top" },
          "100%": { scaleY: "1", transformOrigin: "top" },
        },
      },
    },
  },
  plugins: [],
};
