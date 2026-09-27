// Light/dark follows the OS by default; the header toggle cycles auto → light → dark and
// stores the choice (try/catch: storage may be blocked). The inline script runs before paint.
export type ThemePref = 'auto' | 'light' | 'dark';
export const THEME_KEY = 'snugclip-theme';

export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export function readTheme(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(t: ThemePref): void {
  const el = document.documentElement;
  if (t === 'auto') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', t);
  try {
    if (t === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

export function nextTheme(t: ThemePref): ThemePref {
  return t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto';
}
