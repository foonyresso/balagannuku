import { hash2 } from './rng';

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise 0..1 з плавною інтерполяцією. */
export function valueNoise(x: number, y: number, salt: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash2(x0, y0, salt), b = hash2(x0 + 1, y0, salt);
  const c = hash2(x0, y0 + 1, salt), d = hash2(x0 + 1, y0 + 1, salt);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/** Фрактальний шум (3 октави), 0..1. */
export function fbm(x: number, y: number, salt: number): number {
  let sum = 0, amp = 0.55, freq = 1, norm = 0;
  for (let i = 0; i < 3; i++) {
    sum += valueNoise(x * freq, y * freq, salt + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
