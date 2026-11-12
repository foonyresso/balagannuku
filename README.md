# Балаганники

Vite + TypeScript (strict) + PixiJS.

## Розробка
```
npm install
npm run dev
npm run build   # -> dist
npm run check   # типи, тести, збірка, headless-смоуки
```

## Cloudflare Pages
- Framework preset: None (або Vite)
- Build command: `npm run build`
- Build output directory: `dist`
- Node: 22 (змінна середовища `NODE_VERSION=22`)
- Production branch: `main`

Структура й правила роботи з кодом: `CLAUDE.md` (корінь і кожен каталог `src/`), огляд у `docs/ARCHITECTURE.md`.
