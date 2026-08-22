/**
 * The deployed Apps Script web app — the one JSON endpoint both the dev harness
 * and the static PWA build talk to.
 *
 * Override with AK_EXEC=<url> to point a build or the harness at a different
 * deployment (a test deployment, or the harness's own /api during local work).
 */
export const EXEC = process.env.AK_EXEC
  || 'https://script.google.com/macros/s/AKfycbwDuEBNjOtMhRro9ug_Zc1DvvbfHu-Jc8sEQSPuCe8pU7fePEyhwBs_MLkLxXORN5tYpQ/exec';
