import base from '@fides/config/eslint/base';

export default [
  ...base,
  {
    rules: {
      // NestJS DI needs value imports for injected classes; disable the
      // type-import rewrite that would break metadata reflection.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
