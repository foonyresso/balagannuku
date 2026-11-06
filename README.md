# Балаганники

Vite + TypeScript (strict) + PixiJS.

## Розробка
```
npm install
npm run dev
npm run build   # -> dist
```

## Cloudflare Pages
- Framework preset: None (або Vite)
- Build command: `npm run build`
- Build output directory: `dist`
- Node: 22 (змінна середовища `NODE_VERSION=22`)
- Production branch: `main`

Структура: `src/{shared,sim,render,net,ui}`.
