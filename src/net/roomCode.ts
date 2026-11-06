import { ROOM_CODE_LENGTH } from '../shared';

// Без неоднозначних символів (0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

/** Id піра на сигнальному сервері PeerJS. */
export const peerIdForRoom = (code: string): string => `balagannuku-${code}`;
