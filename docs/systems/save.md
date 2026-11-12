# Збереження

Контракт: `shared/save.ts`. Реалізація: `src/persist/`. Серіалізація світу: `serialize` / `deserialize` у `sim/world.ts`.

- Один `.save` файл: `magic`, `version`, `state` (`SerializedGameState`), `speed`. JSON, typed arrays пакуються в `PackedArray` (base64), файл стискається gzip.
- Робочі дані (`SectorRt`, `NpcRt`) напряму не зберігаються: трафік і залишки вузлів пакуються в `SectorState.trails` / `nodes`. Після завантаження NPC перепланують дію.
- Автосейв в IndexedDB: поточна й попередня копія, інтервал `AUTOSAVE_INTERVAL_MS`. Зберігає лише хост.
- «Продовжити»: завантажити сейв -> лобі з новим кодом кімнати -> гравці повертаються за токеном.

## Зміна формату
1. Змінилась форма `SerializedGameState` або константи сітки: підніми `SAVE_VERSION`.
2. Додай `MIGRATIONS[стара_версія]`: чиста функція зі старого файла в новий.
3. Якщо перенести неможливо (змінився розмір карти), міграція кидає помилку з текстом для гравця «почни нову гру». Світ без міста зазвичай переноситься скиданням `trails` і `nodes`.
4. Новий typed array в `NpcStore`: значення за замовчуванням створює `deserialize`, міграція лише піднімає номер.

Перевірка: `src/persist/persist.test.ts`, наскрізно `scripts/smoke-save.cjs`.

## v10: темний світ
Контракти етапу 0 (`docs/DESIGN-dark-world.md`). У `MIGRATIONS[9]` додано `world.clockShift`, `walls`, `monsters`, `pois` з лічильниками id. Масиви NPC переводить `fillNpcDefaults` (`sim/npcStore.ts`): маска `perks` стає `perkSlots` (`perkSlotsFromMask`), спорядження з 4 слотів у 6, стати з stride 5 у 10, решта нових масивів (клас, xp, мана, золото, настрій, баф, `candidateUntil`) нормою. Нові поля споруд (`hp`, `builder`, `level`, `slots`, `products`, `recipe`) і `SectorState.discovered` необов'язкові. Тест: `src/persist/migrate10.test.ts`.
