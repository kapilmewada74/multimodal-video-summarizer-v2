"use client";

import { useCallback, useEffect, useState } from "react";

/** The light/dark theme, remembered in the browser (same behavior as the home page). */
export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    let saved: "dark" | "light" = "light";
    try {
      saved = (localStorage.getItem("theme") as "dark" | "light") || "light";
    } catch {
      // storage unavailable: keep the default
    }
    setTheme(saved);
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(saved);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("theme", next);
      } catch {
        // ignore
      }
      document.documentElement.classList.remove("dark", "light");
      document.documentElement.classList.add(next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
