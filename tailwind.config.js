/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['"Rubik Variable"', 'Rubik', 'system-ui', 'sans-serif'] },
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        elev: 'rgb(var(--elev) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        primary: { DEFAULT: 'rgb(var(--primary) / <alpha-value>)', fg: 'rgb(var(--primary-fg) / <alpha-value>)', soft: 'rgb(var(--primary-soft) / <alpha-value>)' },
        pos: { DEFAULT: 'rgb(var(--pos) / <alpha-value>)', soft: 'rgb(var(--pos-soft) / <alpha-value>)' },
        neg: { DEFAULT: 'rgb(var(--neg) / <alpha-value>)', soft: 'rgb(var(--neg-soft) / <alpha-value>)' },
        warn: { DEFAULT: 'rgb(var(--warn) / <alpha-value>)', soft: 'rgb(var(--warn-soft) / <alpha-value>)' },
      },
      borderRadius: { xl: '0.9rem', '2xl': '1.25rem', '3xl': '1.75rem' },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 40 / 0.04), 0 4px 16px -4px rgb(16 24 40 / 0.06)',
        pop: '0 12px 40px -8px rgb(16 24 40 / 0.25)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-up': { from: { transform: 'translateY(16px)', opacity: 0 }, to: { transform: 'translateY(0)', opacity: 1 } },
      },
      animation: { 'fade-in': 'fade-in .18s ease-out', 'slide-up': 'slide-up .22s cubic-bezier(.2,.8,.2,1)' },
    },
  },
  plugins: [],
};
