# Мережа

Контракт: `shared/net.ts`. Реалізація: `src/net/`.

- WebRTC через PeerJS, хост-авторитетна модель. Симуляцію веде хост.
- Вхід: код кімнати + нікнейм + токен. Токен зберігається в браузері й повертає гравця у власне місто. Якщо токен втрачено, хост призначає місто вручну з лобі.
- Клієнт шле `command`, хост відповідає `command_result`.
- За контрактом хост розсилає дискретні `events` між знімками й повний `snapshot` раз на `SNAPSHOT_INTERVAL_TICKS`.
- Швидкістю гри керує хост (`speed`), клієнти лише застосовують.
- Світ живе, лише поки хост онлайн.
- Зміна повідомлень вимагає підняти `NET_PROTOCOL_VERSION`; клієнт зі старою версією отримує `protocol_mismatch`.

Реалізовано зараз: лобі, знімок у `welcome`, вибір старту подією `sector_claimed`, швидкість гри (`MapState` у `net/session.ts`). Місто симулюється на хості й клієнтам ще не передається.

Тести мережу не піднімають: з'єднання підміняє заглушка `Conn` (`src/net/lobby.test.ts`).

## Протокол 2
Додано команди темного світу (`place_wall`, `mark_clear`, `upgrade_building`, `set_building_recipe`, `accept_candidate`, `dismiss_candidate`, `train_archer`, `assign_garrison`, `admin`), події (`phase_changed`, `wall_placed`, `wall_removed`, `candidate_arrived`, `candidate_left`, `npc_died`) і необов'язкове `welcome.adminEnabled`. Поки хост відхиляє нові команди (`invalid`, а `admin` як `not_admin`), поведінка приходить зі своїми етапами.
