/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Routes, Route } from "react-router";
import Home from "./pages/Home";
import GenerateNotes from "./pages/GenerateNotes";
import InteractiveSession from "./pages/InteractiveSession";
import StudyProjects from "./pages/StudyProjects";
import StudyPlan from "./pages/StudyPlan";
import { useStore } from "./store";

export default function App() {
  const theme = useStore((state) => state.theme);

  return (
    <div className={`min-h-screen transition-colors duration-200 ${theme === "dark" ? "bg-slate-950 text-slate-100" : "bg-gray-50 text-gray-900"} font-sans`}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/generate" element={<GenerateNotes />} />
        <Route path="/session" element={<InteractiveSession />} />
        <Route path="/projects" element={<StudyProjects />} />
        <Route path="/plan" element={<StudyPlan />} />
      </Routes>
    </div>
  );
}
