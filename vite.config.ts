import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';

function sha(): string {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? 'dev'; }
}
const build = `${process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? sha()} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;

/** Підставляє мітку збірки в index.html. */
const buildLabel = (): Plugin => ({
  name: 'build-label',
  transformIndexHtml: (html) => html.replace('__BUILD__', build),
});

export default defineConfig({
  build: { target: 'es2022' },
  plugins: [buildLabel()],
});
