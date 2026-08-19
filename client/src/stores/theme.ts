import { create } from "zustand";

type ThemeState = {
  dark: false;
  toggle: () => void;
  hydrate: () => void;
};

export const useTheme = create<ThemeState>(() => ({
  dark: false,
  toggle: () => {},          // no-op — always light
  hydrate: () => {
    // Ensure dark class is never applied
    document.documentElement.classList.remove("dark");
    localStorage.removeItem("seal-theme");
  },
}));
