# persist: збереження

Формат файла й міграції лежать у `../shared/save.ts`. Огляд: `docs/systems/save.md`.

## Файли
- `saveFile.ts`: `createSave`, `encodeSave` / `decodeSave` (gzip), `loadGame`, `SaveError` з текстом для гравця.
- `storage.ts`: автосейв в IndexedDB (поточна й попередня копія в одній транзакції), експорт та імпорт `.save` файла.
- `controller.ts`: `SaveController`. Автосейв за таймером, ручні Save / Load, помилки не ковтає.
- `saveMenu.ts`: плаваюча кнопка «Збереження».
- `config.ts`: `AUTOSAVE_INTERVAL_MS`.

## Правила
- Зберігає лише хост.
- Несумісний сейв дає `SaveError` з текстом «почни нову гру», а не падіння.
- У тестах IndexedDB підміняє `fake-indexeddb`. Наскрізна перевірка: `scripts/smoke-save.cjs`.
