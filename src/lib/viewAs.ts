import type { Session } from '../types';
import { PRESENTATION_ROLE_ID } from '../types';
import { DEFAULT_ROLES } from './permissions';

export const VIEW_AS_KEY = 'gmp-wh-view-as';

export function viewAsOptions(): { roleId: string; name: string }[] {
  const rows = DEFAULT_ROLES.filter((r) => r.active).map((r) => ({
    roleId: r.roleId,
    name: r.roleId === PRESENTATION_ROLE_ID ? 'All access' : r.name,
  }));
  rows.sort((a, b) => {
    if (a.roleId === PRESENTATION_ROLE_ID) return -1;
    if (b.roleId === PRESENTATION_ROLE_ID) return 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

export function loadViewAs(): string {
  try {
    return sessionStorage.getItem(VIEW_AS_KEY) || PRESENTATION_ROLE_ID;
  } catch {
    return PRESENTATION_ROLE_ID;
  }
}

export function saveViewAs(roleId: string): void {
  try {
    sessionStorage.setItem(VIEW_AS_KEY, roleId);
  } catch {
    /* ignore */
  }
}

export function clearViewAs(): void {
  try {
    sessionStorage.removeItem(VIEW_AS_KEY);
  } catch {
    /* ignore */
  }
}

/** Presentation only: overlay the matrix role the super account is walking through. */
export function applyViewAs(session: Session, viewAs: string): Session {
  if (session.role !== PRESENTATION_ROLE_ID) return session;
  const known = DEFAULT_ROLES.some((r) => r.roleId === viewAs) ? viewAs : PRESENTATION_ROLE_ID;
  if (known === PRESENTATION_ROLE_ID) {
    return { ...session, role: PRESENTATION_ROLE_ID, roleName: 'Presentation Superuser' };
  }
  const name = DEFAULT_ROLES.find((r) => r.roleId === known)?.name ?? known;
  return { ...session, role: known, roleName: name };
}
