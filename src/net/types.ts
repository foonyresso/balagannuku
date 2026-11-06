import type { ClientMessage, HostMessage } from '../shared';

/** Абстрактне з'єднання (WebRTC data channel або тестова заглушка). */
export interface Conn<In, Out> {
  send(msg: Out): void;
  onMessage(cb: (msg: In) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}
export type HostSideConn = Conn<ClientMessage, HostMessage>;
export type ClientSideConn = Conn<HostMessage, ClientMessage>;
