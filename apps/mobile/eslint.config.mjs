import react from '@fides/config/eslint/react';

export default [
  ...react,
  { ignores: ['babel.config.js', 'metro.config.js', '.expo/**', 'expo-env.d.ts'] },
];
