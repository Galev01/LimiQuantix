/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Quantix dark theme colors
        'qx-base': '#1a1d24',
        'qx-surface': '#21252e',
        'qx-elevated': '#282d38',
        'qx-hover': '#323842',
        'qx-accent': '#5c9cf5',
        'qx-text': '#e4e8ed',
        'qx-muted': '#a0a8b4',
      },
    },
  },
  plugins: [],
};
