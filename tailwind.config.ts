import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        concrete: '#29282F',
        surface: '#34323C',
        surface2: '#403B49',
        violet: { DEFAULT: '#8155B7', 600: '#7149a6', 700: '#5e3d8c' },
        lavender: '#A77BE0',
        ink: '#F1EDF5',
        muted: '#AAA5B2',
        up: '#4ADE80',
        down: '#F87171',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
};
export default config;
