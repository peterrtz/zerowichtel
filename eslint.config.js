import globals from 'globals';

export default [
  { ignores: ['public/js/vendor/**', 'node_modules/**', 'dist/**'] },
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-dupe-keys': 'error',
      'no-self-assign': 'error',
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      // t und tn sind die Übersetzungsfunktionen (lib/i18n.js) – nicht überdecken
      'no-restricted-syntax': ['error',
        { selector: 'VariableDeclarator[id.name=/^tn?$/]', message: 't/tn ist für Übersetzungen reserviert.' },
        { selector: ':function > Identifier.params[name=/^tn?$/]', message: 't/tn ist für Übersetzungen reserviert.' },
        { selector: 'CatchClause > Identifier.param[name=/^tn?$/]', message: 't/tn ist für Übersetzungen reserviert.' }],
    },
  },
  {
    files: ['public/js/theme.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
  {
    files: ['server/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['tests/**/*.mjs', 'bin/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }], 'no-undef': 'error' },
  },
];
