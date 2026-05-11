import type { Config } from 'tailwindcss';

// CSS variables are the source of truth (see src/styles/tokens.css). Tailwind
// utility classes route through `var(--…)` so a future light theme just
// flips the variable values.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        'panel-2': 'var(--panel-2)',
        line: 'var(--line)',
        text: 'var(--text)',
        dim: 'var(--dim)',
        sub: 'var(--sub)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        good: 'var(--good)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        'accent-shadow': 'var(--accent-shadow)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        headline: ['"Press Start 2P"', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '14px',
      },
      boxShadow: {
        btn: '0 3px 0 0 var(--accent-shadow)',
        'btn-lg': '0 4px 0 0 var(--accent-shadow), 0 6px 18px rgba(0,0,0,.25)',
        'bevel-in': 'inset 2px 2px 0 0 rgba(255,255,255,.35), inset -2px -2px 0 0 rgba(0,0,0,.5)',
      },
    },
  },
  plugins: [],
} satisfies Config;
