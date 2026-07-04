import fidesPreset from '@fides/ui-web/tailwind-preset';

/** @type {import('tailwindcss').Config} */
const config = {
  presets: [fidesPreset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui-web/src/**/*.{ts,tsx}'],
};

export default config;
