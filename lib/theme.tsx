"use client";

// Arena Night (dark) is the default; .light on <html> switches to the day
// theme. The choice is kept per browser. THEME_SCRIPT runs before paint so a
// light-theme reload doesn't flash dark.

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "arena.theme";

export const THEME_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="light")document.documentElement.classList.add("light")}catch(e){}`;

const ThemeContext = createContext<{ theme: Theme; setTheme(t: Theme): void } | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.classList.toggle("light", t === "light");
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // private mode: lasts until reload
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}
