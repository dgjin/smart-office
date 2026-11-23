export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './helpCatalog.ts',
    './components/**/*.{ts,tsx}'
  ],
  safelist: [
    {
      pattern: /^(bg|text|border|ring)-(coamc|indigo|emerald|orange|rose|purple|amber)-(50|100|200|300|500|600|700)(\/20|\/30)?$/,
      variants: ['hover', 'group-hover']
    }
  ],
  theme: {
    extend: {
      colors: {
        coamc: {
          50: '#edf4f9',
          100: '#dce9f3',
          200: '#bdd5e7',
          300: '#83b9e3',
          500: '#1263a5',
          600: '#00427f',
          700: '#003366'
        }
      }
    }
  }
};
