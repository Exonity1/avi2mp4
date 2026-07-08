/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'neon-violet': '0 0 15px rgba(139, 92, 246, 0.25)',
        'neon-emerald': '0 0 15px rgba(16, 185, 129, 0.25)',
        'neon-cyan': '0 0 15px rgba(6, 182, 212, 0.25)',
      }
    },
  },
  plugins: [],
}
