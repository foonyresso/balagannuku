# net: мережа

WebRTC через PeerJS, хост-авторитетна модель. Формат повідомлень лежить у `../shared/net.ts`. Огляд протоколу: `docs/systems/net.md`.

## Файли
- `types.ts`: `Conn`, абстрактне з'єднання (data channel або тестова заглушка).
- `peer.ts`: `openRoom`, `connectToRoom` поверх PeerJS.
- `roomCode.ts`: генерація й перевірка коду кімнати.
- `host.ts`: `HostLobby`. Приймає join, видає id і токени, розсилає список гравців.
- `client.ts`: `ClientLobby`. join, оновлення лобі, welcome, збереження токена.
- `session.ts`: `HostSession` / `ClientSession` після старту гри, `MapState`, `mkPlayer`.

## Правила
- Справжню мережу в тестах не піднімай: з'єднання підміняй заглушкою `Conn` (приклад у `lobby.test.ts`).
- Клієнт стан не змінює: шле `command`, малює те, що прийшло від хоста.
- Змінив `ClientMessage`, `HostMessage` або `GameEvent`: підніми `NET_PROTOCOL_VERSION`.
