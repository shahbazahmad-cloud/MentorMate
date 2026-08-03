import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useStore } from "../store";
import { ChevronLeft, Home as HomeIcon, Play, BookOpen, Clock, Award, CheckCircle, Circle, MapPin, Sparkles } from "lucide-react";
import { collection, addDoc, updateDoc, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../components/AuthProvider";
import { savePdfToCache } from "../utils/pdfCache";
import { savePdfForSession } from "../utils/pdfStorage";

interface Milestone {
  id: number;
  title: string;
  description: string;
  duration: string;
  keyTopics: string[];
}

interface StudyPlanData {
  estimatedHours: number;
  difficulty: string;
  milestones: Milestone[];
}

let globalSavePromise: Promise<string | null> | null = null;
let globalSavedPdfName: string | null = null;

export default function StudyPlan() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentPdfDataUrl = useStore((state) => state.currentPdfDataUrl);
  const currentPdfName = useStore((state) => state.currentPdfName);
  const currentSessionId = useStore((state) => state.currentSessionId);
  const setCurrentPdf = useStore((state) => state.setCurrentPdf);
  
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<StudyPlanData | null>(null);
  const [completedMilestones, setCompletedMilestones] = useState<number[]>([]);
  const [savingSession, setSavingSession] = useState(false);

  const saveSessionIfNeeded = async (): Promise<string | null> => {
    if (!user) return null;
    const existingId = useStore.getState().currentSessionId;
    if (existingId) return existingId;
    if (!currentPdfName || !currentPdfDataUrl) return null;

    // Check if there is an in-flight save for this exact file
    if (globalSavedPdfName === currentPdfName && globalSavePromise) {
      return globalSavePromise;
    }

    setSavingSession(true);
    globalSavedPdfName = currentPdfName;

    globalSavePromise = (async () => {
      try {
        const docRef = await addDoc(collection(db, "sessions"), {
          userId: user.uid,
          filename: currentPdfName,
          duration: 0,
          startedAt: new Date().toISOString(),
          pdfData: "saving...",
          chatMessages: [{ role: 'ai', text: "Hello! I'm MentorMate AI. I'm ready to help you study. What would you like to discuss from your notes today?" }],
          lastPage: 1,
          started: false
        });

        const { pdfData } = await savePdfForSession(docRef.id, currentPdfDataUrl);
        await updateDoc(doc(db, "sessions", docRef.id), { pdfData });

        setCurrentPdf(currentPdfDataUrl, currentPdfName, docRef.id);
        console.log("Automatically saved session to database ID:", docRef.id);
        return docRef.id;
      } catch (dbErr) {
        console.error("Failed to save study session database record:", dbErr);
        return null;
      } finally {
        setSavingSession(false);
      }
    })();

    return globalSavePromise;
  };

  useEffect(() => {
    // If no pdf name exists, navigate back
    if (!currentPdfName) {
      navigate("/");
      return;
    }

    const generatePlan = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/gemini/study-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pdfName: currentPdfName,
            firstPageText: currentPdfDataUrl ? currentPdfDataUrl.substring(0, 5000) : ""
          })
        });
        
        const data = await response.json();
        setPlan(data);
        
        // Load initial completion status from localStorage if any
        const saved = localStorage.getItem(`plan-completed-${currentPdfName}`);
        if (saved) {
          try {
            setCompletedMilestones(JSON.parse(saved));
          } catch (e) {
            console.error("Failed to parse saved completion milestones", e);
          }
        }
      } catch (err) {
        console.error("Failed to fetch plan from API", err);
      } finally {
        setLoading(false);
      }
    };

    generatePlan();
  }, [currentPdfName, currentPdfDataUrl, navigate]);

  // Handle eager automated saving when user, document, and session state are ready
  useEffect(() => {
    if (user && currentPdfName && currentPdfDataUrl && !currentSessionId) {
      saveSessionIfNeeded();
    }
  }, [user, currentPdfName, currentPdfDataUrl, currentSessionId]);

  const toggleMilestone = (id: number) => {
    const isCompleted = completedMilestones.includes(id);
    let newCompleted;
    if (isCompleted) {
      newCompleted = completedMilestones.filter(mid => mid !== id);
    } else {
      newCompleted = [...completedMilestones, id];
    }
    setCompletedMilestones(newCompleted);
    if (currentPdfName) {
      localStorage.setItem(`plan-completed-${currentPdfName}`, JSON.stringify(newCompleted));
    }
  };

  const handleGoHome = async () => {
    await saveSessionIfNeeded();
    navigate("/");
  };

  const startStudySession = async () => {
    await saveSessionIfNeeded();
    navigate("/session");
  };

  if (!currentPdfName) return null;

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-12 min-h-screen bg-slate-50 flex flex-col justify-between">
      <div>
        {/* BACK / NAV LINK */}
        <div className="flex items-center justify-between mb-8">
          <button 
            onClick={handleGoHome} 
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition"
          >
            <ChevronLeft size={18} />
            Back to Dashboard
          </button>
          
          <span className="text-xs font-mono font-bold bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full flex items-center gap-1">
            <Sparkles size={12} className="animate-spin duration-1000" /> AI-Generated Roadmap
          </span>
        </div>

        {/* HEADER SECTION */}
        <header className="mb-10 bg-white rounded-2xl p-6 md:p-8 border border-slate-100 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="bg-emerald-50 text-emerald-600 p-3.5 rounded-2xl">
              <BookOpen size={28} />
            </div>
            <div className="space-y-1">
              <span className="text-slate-400 text-xs font-semibold tracking-wider uppercase">Document Loaded</span>
              <h1 className="text-2xl font-extrabold text-slate-950 line-clamp-2 leading-tight">
                {currentPdfName}
              </h1>
              <p className="text-slate-500 text-sm">
                Your custom study timeline is configured. Review your checkpoints below before starting.
              </p>
            </div>
          </div>

          {!loading && plan && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-100">
              <div className="bg-slate-50/50 p-3.5 rounded-xl border border-slate-100 flex items-center gap-3">
                <Clock className="text-blue-500 shrink-0" size={20} />
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Estimated Time</p>
                  <p className="text-sm font-extrabold text-slate-800">{plan.estimatedHours || 8} Hours</p>
                </div>
              </div>
              <div className="bg-slate-50/50 p-3.5 rounded-xl border border-slate-100 flex items-center gap-3">
                <Award className="text-amber-500 shrink-0" size={20} />
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Difficulty</p>
                  <p className="text-sm font-extrabold text-slate-800">{plan.difficulty || "Intermediate"}</p>
                </div>
              </div>
              <div className="col-span-2 sm:col-span-1 bg-slate-50/50 p-3.5 rounded-xl border border-slate-100 flex items-center gap-3">
                <div className="relative shrink-0 flex items-center justify-center">
                  <CheckCircle className="text-emerald-500" size={20} />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Roadmap Progress</p>
                  <p className="text-sm font-extrabold text-slate-800">
                    {completedMilestones.length} of 5 Done
                  </p>
                </div>
              </div>
            </div>
          )}
        </header>

        {loading ? (
          <div className="bg-white rounded-2xl p-12 shadow-sm border border-slate-100 flex flex-col items-center justify-center space-y-4">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500"></div>
            <h3 className="text-lg font-bold text-slate-800">Formulating Study Plan...</h3>
            <p className="text-slate-400 text-sm max-w-sm text-center">Analyzing document headers, subjects, and definitions to generate milestones...</p>
          </div>
        ) : (
          <div className="space-y-6" id="study-milestones-list">
            <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2 px-1">
              <span>Study Milestones Checkpoints</span>
            </h2>

            {plan?.milestones.map((milestone, idx) => {
              const isChecked = completedMilestones.includes(milestone.id);

              return (
                <div 
                  key={milestone.id}
                  onClick={() => toggleMilestone(milestone.id)}
                  className={`bg-white rounded-2xl p-5 md:p-6 border transition-all cursor-pointer flex gap-4 md:gap-5 group ${
                    isChecked 
                      ? "border-emerald-200 bg-emerald-50/10 opacity-80" 
                      : "border-slate-100 hover:border-slate-200 hover:shadow-sm"
                  }`}
                  id={`milestone-card-${milestone.id}`}
                >
                  <button 
                    type="button"
                    className={`mt-0.5 shrink-0 transition-colors ${
                      isChecked ? "text-emerald-500" : "text-slate-300 group-hover:text-slate-400"
                    }`}
                  >
                    {isChecked ? <CheckCircle size={24} fill="currentColor" className="text-white fill-emerald-500" /> : <Circle size={24} />}
                  </button>

                  <div className="space-y-2 flex-grow">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <h4 className={`text-base font-bold transition-all ${
                        isChecked ? "text-slate-500 line-through" : "text-slate-900"
                      }`}>
                        {idx + 1}. {milestone.title}
                      </h4>
                      <span className="text-xs font-mono font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md self-start sm:self-center shrink-0">
                        {milestone.duration}
                      </span>
                    </div>

                    <p className={`text-sm leading-relaxed ${
                      isChecked ? "text-slate-400" : "text-slate-600"
                    }`}>
                      {milestone.description}
                    </p>

                    {milestone.keyTopics && milestone.keyTopics.length > 0 && (
                      <div className="pt-2 flex flex-wrap gap-1.5">
                        {milestone.keyTopics.map((topic, i) => (
                          <span 
                            key={i} 
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                              isChecked 
                                ? "bg-slate-100 text-slate-400" 
                                : "bg-blue-50 text-blue-600 group-hover:bg-blue-100/80"
                            }`}
                          >
                            • {topic}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FOOTER ACTIONS - OPTIONS HOME AND START SESSION */}
      <footer className="mt-12 bg-white rounded-2xl p-5 border border-slate-100 shadow-md flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="text-center sm:text-left space-y-0.5">
          <p className="text-sm font-extrabold text-slate-800">Ready to learn?</p>
          <p className="text-slate-500 text-xs text-balance">
            {savingSession ? "Saving study project to database..." : "Enter your interactive study session to review notes and study voiced with MentorMate AI."}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <button
            onClick={handleGoHome}
            disabled={savingSession}
            className="w-full sm:w-auto px-6 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer border border-slate-200/50 disabled:opacity-75"
            id="redirect-home-btn"
          >
            <HomeIcon size={16} />
            Home
          </button>
          
          <button
            disabled={loading || savingSession}
            onClick={startStudySession}
            className="w-full sm:w-auto px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 active:translate-y-0"
            id="redirect-session-btn"
          >
            <Play size={16} fill="currentColor" />
            Start Session
          </button>
        </div>
      </footer>
    </div>
  );
}
