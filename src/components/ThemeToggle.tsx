import { useEffect, useState } from 'react';
import { applyTheme, getThemePref, setThemePref, type ThemePref } from '../lib/theme';

const OPTIONS: { id: ThemePref; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Auto' },
];

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() => getThemePref());
  useEffect(() => {
    applyTheme(pref);
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Color theme">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={pref === o.id}
          className={pref === o.id ? 'theme-opt on' : 'theme-opt'}
          onClick={() => {
            setPref(o.id);
            setThemePref(o.id);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
