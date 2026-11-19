// OIPiP w Słupsku. Preset Tailwind CSS 3, wygenerowany z tokens.json przez generuj.mjs.
// Kolory czytają zmienne z tokens.css, więc działa też motyw ciemny. Preset zastępuje domyślną paletę i cienie Tailwinda.
// Użycie w tailwind.config.js: presets: [require('./brand/tokens/tailwind.preset.cjs')]
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="ciemny"]'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      'czerwien': 'var(--czerwien)',
      'czerwien-ciemna': 'var(--czerwien-ciemna)',
      'grafit-900': 'var(--grafit-900)',
      'grafit-800': 'var(--grafit-800)',
      'grafit-700': 'var(--grafit-700)',
      'szary': 'var(--szary)',
      'bialy': 'var(--bialy)',
      'tlo': 'var(--tlo)',
      'powierzchnia': 'var(--powierzchnia)',
      'powierzchnia-miekka': 'var(--powierzchnia-miekka)',
      'tekst': 'var(--tekst)',
      'tekst-mocny': 'var(--tekst-mocny)',
      'tekst-drugorzedny': 'var(--tekst-drugorzedny)',
      'tekst-wylaczony': 'var(--tekst-wylaczony)',
      'akcent-tekst': 'var(--akcent-tekst)',
      'akcent-duzy': 'var(--akcent-duzy)',
      'na-akcencie': 'var(--na-akcencie)',
      'linia': 'var(--linia)',
      'linia-jasna': 'var(--linia-jasna)',
      'linia-aktywna': 'var(--linia-aktywna)',
      'obrys-pola': 'var(--obrys-pola)',
      'fokus': 'var(--fokus)',
      'klin': 'var(--klin)',
      'stan-tak': 'var(--stan-tak)',
      'stan-czesciowo': 'var(--stan-czesciowo)',
      'stan-nie': 'var(--stan-nie)',
      'stan-brak': 'var(--stan-brak)',
      'na-stanie': 'var(--na-stanie)',
    },
    boxShadow: {
      none: 'none',
      'cien-karty': 'var(--cien-karty)',
    },
    // Izba nie zaokrągla rogów, więc każda klasa rounded-* daje 0.
    borderRadius: { none: '0', DEFAULT: '0', sm: '0', md: '0', lg: '0', xl: '0', '2xl': '0', '3xl': '0', full: '0' },
    extend: {
      fontFamily: { sans: ['"Titillium Web"', 'system-ui', '-apple-system', '"Segoe UI"', 'Arial', 'sans-serif'] },
      spacing: {
        'odstep-1': '4px',
        'odstep-2': '8px',
        'odstep-3': '12px',
        'odstep-4': '16px',
        'odstep-5': '20px',
        'odstep-6': '24px',
        'odstep-8': '32px',
        'odstep-11': '44px',
        'odstep-14': '58px',
      },
      skew: {
        'kat-skosu': '-13deg',
        'kat-odwrotny': '13deg',
      },
      borderWidth: {
        'kreska': '1px',
        'kreska-mocna': '2px',
        'pasek-karty': '5px',
        'pasek-akcentu': '6px',
        'pierscien-fokusu': '3px',
      },
      maxWidth: {
        'kolumna': '75rem',
        'wiersz-tekstu': '70ch',
      },
    },
  },
};
