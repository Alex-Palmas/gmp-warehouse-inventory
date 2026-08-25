export type ThemePref = 'light' | 'dark' | 'system';
const PREF_KEY = 'gmp-wh-theme-pref';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* private mode */
  }
  return 'system';
}

export function resolvedTheme(pref: ThemePref = getThemePref()): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(pref: ThemePref = getThemePref()): 'light' | 'dark' {
  const resolved = resolvedTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

export function setThemePref(pref: ThemePref): 'light' | 'dark' {
  try {
    localStorage.setItem(PREF_KEY, pref);
  } catch {
    /* ignore */
  }
  return applyTheme(pref);
}
