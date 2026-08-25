/** Short success/error beep via Web Audio (no external files) plus a page flash. */

export const FLASH_EVENT = 'gmp-wh-flash';

let _ctx: AudioContext | null = null;

function ctx(): AudioContext | null {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!_ctx) _ctx = new AC();
    if (_ctx.state === 'suspended') void _ctx.resume();
    return _ctx;
  } catch {
    return null;
  }
}

function tone(frequency: number, duration: number, type: OscillatorType, startAt = 0): void {
  const ac = ctx();
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = frequency;
  o.connect(g);
  g.connect(ac.destination);
  const t0 = ac.currentTime + startAt;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  o.start(t0);
  o.stop(t0 + duration + 0.02);
}

export function beepSuccess(): void {
  tone(880, 0.11, 'sine');
}

export function beepError(): void {
  tone(220, 0.12, 'square', 0);
  tone(180, 0.16, 'square', 0.14);
}

export function flashScan(kind: 'ok' | 'err', message?: string): void {
  window.dispatchEvent(new CustomEvent(FLASH_EVENT, { detail: { kind, message: message ?? (kind === 'ok' ? 'OK' : 'Error') } }));
}

export function scanOk(message?: string): void {
  beepSuccess();
  flashScan('ok', message);
}

export function scanErr(message?: string): void {
  beepError();
  flashScan('err', message);
}
