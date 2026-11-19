// lib/theme.ts
//
// Light / dark / system theme, stored per browser in localStorage. The class
// "dark" on <html> switches the dark styles in globals.css. The same logic runs
// as an inline script in app/layout.tsx before the page paints, so there is no
// white flash when dark mode is on.

export type ThemeChoice = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'ifix-theme'

export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');var d=t==='dark'||((t===null||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`

export function getThemeChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(STORAGE_KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Private mode etc.: still apply for this page view
  }
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}
