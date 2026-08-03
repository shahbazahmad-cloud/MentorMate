import { create } from "zustand";

interface AppState {
  currentPdfDataUrl: string | null;
  currentPdfName: string | null;
  currentSessionId: string | null;
  interactiveTimer: number; // in seconds
  isSessionActive: boolean;
  setCurrentPdf: (url: string | null, name: string | null, sessionId?: string) => void;
  incrementTimer: () => void;
  setTimer: (time: number) => void;
  startSession: () => void;
  pauseSession: () => void;
  endSession: () => void;
  aiVoice: "brit" | "american" | "none";
  setAiVoice: (voice: "brit" | "american" | "none") => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  toggleTheme: () => void;
}

const getInitialTheme = (): "light" | "dark" => {
  if (typeof window !== "undefined") {
    document.documentElement.classList.add("dark");
  }
  return "dark";
};

export const useStore = create<AppState>((set) => ({
  currentPdfDataUrl: null,
  currentPdfName: null,
  currentSessionId: null,
  interactiveTimer: 0,
  isSessionActive: false,
  aiVoice: "american",
  theme: "dark",
  setCurrentPdf: (url, name, sessionId) => set({ currentPdfDataUrl: url, currentPdfName: name, currentSessionId: sessionId || null }),
  incrementTimer: () => set((state) => ({ interactiveTimer: state.interactiveTimer + 1 })),
  setTimer: (time) => set({ interactiveTimer: time }),
  startSession: () => set({ isSessionActive: true }),
  pauseSession: () => set({ isSessionActive: false }),
  endSession: () => set({ isSessionActive: false, interactiveTimer: 0, currentPdfDataUrl: null, currentPdfName: null, currentSessionId: null }),
  setAiVoice: (voice) => set({ aiVoice: voice }),
  setTheme: () => {},
  toggleTheme: () => {},
}));
