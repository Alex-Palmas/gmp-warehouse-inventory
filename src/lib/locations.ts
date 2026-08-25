import type { InventoryRecord, Location } from '../types';

function part(s: string): string {
  return (s || 'X').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'X';
}

/** LOC-SITE-BLDG-ROOM-RACK-SHELF-BIN */
export function locationCode(loc: Location): string {
  return `LOC-${part(loc.site)}-${part(loc.building)}-${part(loc.room)}-${part(loc.rack)}-${part(loc.shelf)}-${part(loc.bin)}`;
}

export function isLocationCode(raw: string): boolean {
  return /^LOC-[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(raw.trim());
}

export function parseLocationCode(raw: string): Location | null {
  const s = raw.trim().toUpperCase();
  if (!s.startsWith('LOC-')) return null;
  const parts = s.split('-');
  if (parts.length < 7) return null;
  return {
    site: parts[1],
    building: parts[2],
    room: parts[3],
    rack: parts[4],
    shelf: parts[5],
    bin: parts.slice(6).join('-'),
  };
}

export const SEEDED_LOCATIONS: Location[] = [
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RQ', shelf: 'S1', bin: 'Q1' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RQ', shelf: 'S1', bin: 'Q2' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RQ', shelf: 'S1', bin: 'Q3' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RQ', shelf: 'S1', bin: 'Q4' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RQ', shelf: 'S1', bin: 'Q5' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RQ', shelf: 'S1', bin: 'Q6' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RQ', shelf: 'S1', bin: 'Q7' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RQ', shelf: 'S1', bin: 'Q8' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RQ', shelf: 'S1', bin: 'Q9' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RA', shelf: 'S1', bin: 'QA' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RB', shelf: 'S1', bin: 'QB' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RC', shelf: 'S1', bin: 'QC' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RD', shelf: 'S1', bin: 'QD' },
  { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'R1', shelf: 'S1', bin: 'RECV' },
];

export function uniqueLocations(inventory: InventoryRecord[]): Location[] {
  const map = new Map<string, Location>();
  for (const loc of SEEDED_LOCATIONS) map.set(locationCode(loc), loc);
  for (const r of inventory) {
    if (!r.location) continue;
    map.set(locationCode(r.location), r.location);
  }
  return [...map.values()];
}

export function resolveLocationScan(raw: string, known: Location[]): Location | null {
  const code = raw.trim().toUpperCase();
  for (const loc of known) {
    if (locationCode(loc) === code) return loc;
  }
  return parseLocationCode(raw);
}

export function locationSortKey(loc: Location | undefined): string {
  if (!loc) return '';
  return [loc.site, loc.building, loc.room, loc.rack, loc.shelf, loc.bin].map((x) => (x || '').toUpperCase()).join('\t');
}

export function sortByLocation<T extends { location?: Location }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => locationSortKey(a.location).localeCompare(locationSortKey(b.location)));
}
