"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Contrast } from "lucide-react";

const THEMES = ["light", "dim", "dark"] as const;
type Theme = (typeof THEMES)[number];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = (localStorage.getItem("stockmind-theme") as Theme) || "light";
    setTheme(stored);
  }, []);

  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("stockmind-theme", next);
  }

  const icons: Record<Theme, React.ReactNode> = {
    light: <Sun size={15} />,
    dim: <Contrast size={15} />,
    dark: <Moon size={15} />,
  };

  return (
    <button
      onClick={cycleTheme}
      title={`현재 테마: ${theme}`}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
    >
      {icons[theme]}
      <span className="hidden sm:inline capitalize">{theme}</span>
    </button>
  );
}
