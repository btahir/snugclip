'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n/en';
import { applyTheme, nextTheme, readTheme, type ThemePref } from '@/lib/theme';

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>('auto');
  useEffect(() => setPref(readTheme()), []);
  const label = pref === 'auto' ? t.nav.themeAuto : pref === 'light' ? t.nav.themeLight : t.nav.themeDark;
  return (
    <button
      type="button"
      className="theme-btn"
      aria-label={label}
      title={label}
      onClick={() => {
        const n = nextTheme(pref);
        applyTheme(n);
        setPref(n);
      }}
    >
      <Icon name={pref === 'auto' ? 'auto' : pref === 'light' ? 'sun' : 'moon'} size={20} />
    </button>
  );
}
