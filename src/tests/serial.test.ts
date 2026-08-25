import { describe, expect, it } from 'vitest';
import { assertSerialUnique, formatSerial, isValidSerial, nextSerial, parseSerial } from '../lib/serial';

describe('serial format', () => {
  it('formats WH-YYYY-NNNNNN zero-padded', () => {
    expect(formatSerial(2026, 1)).toBe('WH-2026-000001');
    expect(formatSerial(2026, 14)).toBe('WH-2026-000014');
    expect(formatSerial(2026, 999999)).toBe('WH-2026-999999');
  });

  it('rejects invalid year or sequence', () => {
    expect(() => formatSerial(1999, 1)).toThrow();
    expect(() => formatSerial(2026, 0)).toThrow();
    expect(() => formatSerial(2026, 1.5)).toThrow();
  });

  it('parses and validates', () => {
    expect(isValidSerial('WH-2026-000001')).toBe(true);
    expect(isValidSerial('WH-2026-1')).toBe(false);
    expect(isValidSerial('INV-2026-000001')).toBe(false);
    expect(parseSerial('WH-2026-000042')).toEqual({ year: 2026, n: 42 });
  });

  it('never reuses within a year and resets on year change', () => {
    const a = nextSerial(2026, 14, 2026);
    expect(a.serial).toBe('WH-2026-000015');
    const b = nextSerial(2026, 14, 2027);
    expect(b.serial).toBe('WH-2027-000001');
  });

  it('assertSerialUnique throws on collision', () => {
    expect(() => assertSerialUnique('WH-2026-000001', ['WH-2026-000002', 'WH-2026-000001'])).toThrow(
      /never be reused/,
    );
    expect(() => assertSerialUnique('WH-2026-000003', ['WH-2026-000001'])).not.toThrow();
  });
});
