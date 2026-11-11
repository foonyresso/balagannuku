// Збирає самодостатню демо-сторінку: demo/packs.template.html + pixi.min.js + атлас -> public/demo-packs.html
// і (за --fragment <файл>) варіант без <html>/<head> для публікації як Artifact.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const tpl = readFileSync(root + 'demo/packs.template.html', 'utf8');
const pixi = readFileSync(root + 'node_modules/pixi.js/dist/pixi.min.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const atlas = 'data:image/png;base64,' + readFileSync(root + 'src/assets/atlas.png').toString('base64');
const body = tpl.replace('{{PIXI}}', () => pixi).replace('{{ATLAS}}', () => atlas);
const head = '<!doctype html>\n<html lang="uk">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n</head>\n<body>\n';
writeFileSync(root + 'public/demo-packs.html', head + body + '\n</body>\n</html>\n');
const i = process.argv.indexOf('--fragment');
if (i > 0) writeFileSync(process.argv[i + 1], body);
console.log('ok', (body.length / 1024) | 0, 'KB');
