import { Application, Graphics } from 'pixi.js';

const app = new Application();
await app.init({ resizeTo: window, background: '#1a1420', antialias: true });
document.getElementById('app')!.appendChild(app.canvas);

const hex = new Graphics();
const r = 60;
const pts: number[] = [];
for (let i = 0; i < 6; i++) {
  const a = (Math.PI / 3) * i;
  pts.push(Math.cos(a) * r, Math.sin(a) * r);
}
hex.poly(pts).fill(0xe0a030).stroke({ width: 3, color: 0xffffff });
app.stage.addChild(hex);

const center = () => hex.position.set(app.screen.width / 2, app.screen.height / 2);
center();
app.renderer.on('resize', center);

import { mountLobby } from './ui';
mountLobby();
