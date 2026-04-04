import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Dark-first developer tool palette (对标 Linear/Vercel)
        background: {
          DEFAULT: '#0f1117',
          secondary: '#161821',
          tertiary: '#1e2028',
        },
        foreground: {
          DEFAULT: '#e5e7eb',
          muted: '#9ca3af',
          subtle: '#6b7280',
        },
        accent: {
          DEFAULT: '#06b6d4',  // cyan-500
          hover: '#22d3ee',    // cyan-400
          muted: '#164e63',    // cyan-900
        },
        success: '#22c55e',
        warning: '#eab308',
        error: '#ef4444',
        info: '#3b82f6',
        border: {
          DEFAULT: '#2d2f3a',
          hover: '#3f4252',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
