/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      boxShadow: {
        shell: '0 30px 80px rgba(15, 23, 42, 0.18)',
        panel: '0 18px 45px rgba(15, 23, 42, 0.14)'
      },
      fontFamily: {
        sans: ['"Segoe UI"', '"Trebuchet MS"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Cascadia Code"', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
};
