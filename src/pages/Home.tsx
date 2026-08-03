import React, { useState, useEffect } from "react";
import { useAuth } from "../components/AuthProvider";
import { useNavigate } from "react-router";
import { BookOpen, FileText, Upload, Plus, Play, LogIn, LogOut, Clock, ArrowRight, AlertTriangle, X, Sun, Moon, Trash2, CheckCircle } from "lucide-react";
import { useStore } from "../store";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
import { db } from "../lib/firebase";
import { formatTime } from "../utils";
import { savePdfToCache, getPdfFromCache } from "../utils/pdfCache";
import { loadPdfForSession } from "../utils/pdfStorage";
import { deleteFileAndHistory } from "../utils/deleteService";

import { pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker || `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

function getSimilarity(str1: string, str2: string): number {
  const norm1 = str1.trim().toLowerCase().replace(/\s+/g, ' ');
  const norm2 = str2.trim().toLowerCase().replace(/\s+/g, ' ');

  if (!norm1 && !norm2) return 1.0;
  if (!norm1 || !norm2) return 0.0;
  if (norm1 === norm2) return 1.0;

  const getBigrams = (text: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.add(text.substring(i, i + 2));
    }
    return bigrams;
  };

  const getWordFreqs = (text: string) => {
    const words = text.match(/\b\w+\b/g) || [];
    const freqs = new Map<string, number>();
    for (const word of words) {
      freqs.set(word, (freqs.get(word) || 0) + 1);
    }
    return freqs;
  };

  const freqs1 = getWordFreqs(norm1);
  const freqs2 = getWordFreqs(norm2);

  const allWords = new Set([...freqs1.keys(), ...freqs2.keys()]);
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (const word of allWords) {
    const val1 = freqs1.get(word) || 0;
    const val2 = freqs2.get(word) || 0;
    dotProduct += val1 * val2;
  }

  for (const val of freqs1.values()) {
    magnitude1 += val * val;
  }
  for (const val of freqs2.values()) {
    magnitude2 += val * val;
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  const wordCosSim = (magnitude1 && magnitude2) ? (dotProduct / (magnitude1 * magnitude2)) : 0;

  const bigrams1 = getBigrams(norm1);
  const bigrams2 = getBigrams(norm2);

  const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
  const union = new Set([...bigrams1, ...bigrams2]);
  
  const bigramJaccardSim = union.size ? (intersection.size / union.size) : 0;

  return (wordCosSim + bigramJaccardSim) / 2;
}

const extractFirstPageText = async (pdfDataUrl: string): Promise<string> => {
  try {
    let base64Parts = pdfDataUrl;
    if (pdfDataUrl.includes(",")) {
      base64Parts = pdfDataUrl.split(",")[1];
    }
    const binaryString = window.atob(base64Parts);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    
    if (pdf.numPages === 0) {
      return "";
    }
    
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => (item as any).str || "")
      .join(" ")
      .trim();
    return text;
  } catch (error) {
    console.error("Error extracting text from PDF first page", error);
    return "";
  }
};

export default function Home() {
  const { user, loading, login, logout } = useAuth();
  const navigate = useNavigate();
  const setCurrentPdf = useStore((state) => state.setCurrentPdf);
  const startSession = useStore((state) => state.startSession);
  
  const [sessions, setSessions] = useState<any[]>([]);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState<{ filename: string; similarity: number } | null>(null);

  // Deletion States
  const [projectToDelete, setProjectToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const executeDeleteSession = async () => {
    if (!projectToDelete || !user) return;
    setIsDeleting(true);
    const targetId = projectToDelete.id;
    try {
      await deleteFileAndHistory(targetId, projectToDelete.filename);

      // Reset active store session if currently studying deleted file
      if (useStore.getState().currentSessionId === targetId || useStore.getState().currentPdfName === projectToDelete.filename) {
        useStore.getState().endSession();
        setCurrentPdf(null, null, null);
      }

      setSessions(prev => prev.filter(s => s.id !== targetId));
      setToastMessage(`"${projectToDelete.filename || 'Project'}" and all its related history have been permanently deleted.`);

      setTimeout(() => {
        setToastMessage(null);
      }, 4000);
    } catch (err) {
      console.error("Failed to delete session", err);
      alert("Failed to delete file and history. Please try again.");
    } finally {
      setIsDeleting(false);
      setProjectToDelete(null);
    }
  };
  
  useEffect(() => {
    if (!user) return;
    const fetchHistory = async () => {
      try {
        const q = query(collection(db, "sessions"), where("userId", "==", user.uid));
        const qs = await getDocs(q);
        const data = qs.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        setSessions(data);
      } catch (err) {
        console.error("Failed to load sessions", err);
      }
    };
    fetchHistory();
  }, [user]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCheckingDuplicate(true);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = reader.result as string;
        const text1 = await extractFirstPageText(result);

        let duplicateFound: { filename: string; similarity: number } | null = null;

        for (const session of sessions) {
          if (!session.filename) continue;

          // Retrieve PDF data seamlessly across devices
          let sessionPdfData = await loadPdfForSession(session.id || "", session);

          if (sessionPdfData) {
            const text2 = await extractFirstPageText(sessionPdfData);
            const sim = getSimilarity(text1, text2);
            console.log(`Comparing with existing project "${session.filename}": similarity ${(sim * 100).toFixed(2)}%`);
            if (sim >= 0.95) {
              duplicateFound = {
                filename: session.filename,
                similarity: sim
              };
              break;
            }
          } else {
            // Check matching filename case-insensitively if PDF content cannot be retrieved
            if (session.filename.toLowerCase() === file.name.toLowerCase()) {
              duplicateFound = {
                filename: session.filename,
                similarity: 1.0
              };
              break;
            }
          }
        }

        if (duplicateFound) {
          setDuplicateModal({
            filename: duplicateFound.filename,
            similarity: duplicateFound.similarity
          });
          setCheckingDuplicate(false);
          e.target.value = "";
          return;
        }

        await savePdfToCache(file.name, result);
        setCurrentPdf(result, file.name);
        setCheckingDuplicate(false);
        navigate("/plan");
      } catch (err) {
        console.error("Error evaluating document similarity", err);
        // Fallback to uploading normally
        const result = reader.result as string;
        await savePdfToCache(file.name, result);
        setCurrentPdf(result, file.name);
        setCheckingDuplicate(false);
        navigate("/plan");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRecentSession = async (session: any) => {
    const pdfData = await loadPdfForSession(session.id || "", session);

    if (pdfData) {
      setCurrentPdf(pdfData, session.filename, session.id);
      navigate("/session");
    } else {
      alert("Unable to load document for this session. Please upload the PDF again.");
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center text-gray-500">Loading MentorMate...</div>;

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-12 relative">
      
      {/* SUCCESS TOAST BANNER */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 bg-slate-900 text-white rounded-xl shadow-xl border border-slate-800 p-4 max-w-sm flex items-start gap-3 transition-all animate-in fade-in slide-in-from-top-4 duration-300">
          <CheckCircle className="text-emerald-500 shrink-0 mt-0.5" size={20} />
          <div className="flex-1">
            <h4 className="font-semibold text-sm">Study File Deleted</h4>
            <p className="text-slate-400 text-xs mt-1">{toastMessage}</p>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white transition">
            <X size={16} />
          </button>
        </div>
      )}

      <header className="flex items-center justify-between mb-12">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 text-white p-2 rounded-xl shadow-md">
            <BookOpen size={28} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-slate-100">MentorMate</h1>
        </div>
        
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500 dark:text-slate-400 font-medium hidden sm:inline">Hi, {user.email?.split("@")[0]}</span>
              <button onClick={logout} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition">
                <LogOut size={16} /> Logout
              </button>
            </div>
          ) : (
            <button onClick={login} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition shadow-sm">
              <LogIn size={16} /> Sign In
            </button>
          )}
        </div>
      </header>

      {!user ? (
        <div className="text-center py-24 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 mt-12 px-6">
          <BookOpen className="mx-auto w-16 h-16 text-blue-500 mb-6" />
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-slate-100 mb-4">Master Your Studies with AI</h2>
          <p className="text-gray-500 dark:text-slate-400 text-lg max-w-xl mx-auto mb-8">
            Upload your notes, generate comprehensive study guides, and interact with MentorMate AI in real-time.
          </p>
          <button onClick={login} className="px-8 py-3 text-lg font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition shadow-md">
            Get Started
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* Top Action Row - Side-by-Side on Mobile and Desktop */}
          <div className="grid grid-cols-2 gap-3 sm:gap-6 md:gap-8">
            {/* Upload Notes Card */}
            <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 flex flex-col items-center border-dashed border-2 border-gray-300 dark:border-slate-700 relative cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/30 transition group min-h-[160px] sm:h-48 justify-center text-center">
              {checkingDuplicate ? (
                <div className="flex flex-col items-center justify-center animate-pulse">
                  <div className="animate-spin rounded-full h-8 w-8 sm:h-10 sm:w-10 border-b-2 border-blue-600 mb-2 sm:mb-4"></div>
                  <h3 className="text-sm sm:text-lg font-semibold text-slate-800 dark:text-slate-200">Reading first page...</h3>
                  <p className="text-gray-500 dark:text-slate-400 text-[10px] sm:text-xs mt-1 text-center select-none hidden sm:block">Checking similarity with existing projects</p>
                </div>
              ) : (
                <>
                  <input type="file" accept="application/pdf" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={handleFileUpload} />
                  <div className="bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 p-2.5 sm:p-4 rounded-full mb-2 sm:mb-3 group-hover:scale-105 transition-transform">
                    <Upload className="w-5 h-5 sm:w-8 sm:h-8" />
                  </div>
                  <h3 className="text-base sm:text-xl font-bold mb-1 dark:text-slate-100 text-center">Upload Notes</h3>
                  <p className="text-gray-500 dark:text-slate-400 text-xs sm:text-sm text-center line-clamp-2">Upload a PDF to start an interactive session</p>
                </>
              )}
            </div>

            {/* Generate Notes Card */}
            <div 
              onClick={() => navigate('/generate')}
              className="bg-gradient-to-br from-blue-600 to-indigo-700 p-4 sm:p-6 md:p-8 rounded-2xl shadow-md text-white cursor-pointer hover:shadow-lg transition group min-h-[160px] sm:h-48 flex flex-col items-center justify-center text-center">
              <div className="bg-white/20 text-white p-2.5 sm:p-4 rounded-full mb-2 sm:mb-3 group-hover:scale-105 transition-transform flex items-center justify-center">
                <FileText className="w-5 h-5 sm:w-8 sm:h-8" />
              </div>
              <h3 className="text-base sm:text-xl font-bold mb-1 text-center">Generate Notes</h3>
              <p className="text-blue-100 text-xs sm:text-sm text-center line-clamp-2">Create smart summaries and study guides using AI</p>
            </div>
          </div>

          {/* Bottom Grid - Study Projects & Recent Sessions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {/* Your Study Projects Section */}
            <div 
              onClick={() => navigate("/projects")}
              className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 flex flex-col justify-between space-y-6 cursor-pointer hover:border-blue-200 dark:hover:border-blue-800 transition group"
              id="your-study-projects-card"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold flex items-center gap-2 dark:text-slate-100">
                  <FileText size={20} className="text-blue-500" />
                  Your Study Projects
                </h3>
                <span 
                  className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-bold text-sm transition group-hover:translate-x-1"
                  id="view-all-projects-btn"
                >
                  View All 
                  <ArrowRight size={16} />
                </span>
              </div>

              <div className="flex flex-col items-center justify-center text-center p-6 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800 flex-1 space-y-2">
                <div className="bg-blue-100/70 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 p-3.5 rounded-full mb-1 group-hover:scale-110 transition-transform">
                  <FileText size={26} />
                </div>
                <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {sessions.length > 0 ? `${sessions.length} Uploaded ${sessions.length === 1 ? 'Document' : 'Documents'}` : 'No uploaded documents yet'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                  Click to open your document library, view all uploaded PDFs, resume study sessions, or delete files.
                </p>
              </div>
            </div>

            {/* Recent Sessions */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-800 flex flex-col justify-between space-y-6">
              <h3 className="text-xl font-bold flex items-center gap-2 dark:text-slate-100">
                <Clock size={20} className="text-blue-500"/> 
                Recent Sessions
              </h3>
              {sessions.filter(s => s.started !== false).length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-slate-400 text-center py-12 flex-1 flex items-center justify-center">No recent sessions found</div>
              ) : (
                <div className="space-y-3 flex-1">
                  {sessions.filter(s => s.started !== false).slice(0, 4).map((session, i) => (
                    <div key={session.id || i} onClick={() => handleRecentSession(session)} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition border border-transparent hover:border-gray-100 dark:hover:border-slate-800 bg-slate-50 dark:bg-slate-900/40 group">
                      <div className="bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 p-2 rounded-lg">
                        <Play size={16} />
                      </div>
                      <div className="overflow-hidden flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-slate-200 truncate">{session.filename || "Study Session"}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">{new Date(session.startedAt).toLocaleDateString()} • {Math.floor(session.duration / 60)}m</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setProjectToDelete(session);
                        }}
                        className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors opacity-80 hover:opacity-100"
                        title="Delete File & History"
                        id={`recent-delete-btn-${session.id || i}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* CONFIRMATION DELETION MODAL */}
      {projectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-slate-950/60 transition-all duration-300">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full shadow-2xl border border-slate-100 dark:border-slate-800 p-6 md:p-8 space-y-6 scale-in transition-all">
            
            <div className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 p-3 rounded-full shrink-0">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Delete File & History?</h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs">This action will erase the file and all associated study history permanently.</p>
              </div>
            </div>

            <div className="space-y-3 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800 text-sm text-slate-700 dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-slate-100 break-words line-clamp-2">
                "{projectToDelete.filename || 'Study Session'}"
              </p>
              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span> 
                  Deletes main PDF document & binary cache
                </p>
                <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span> 
                  Erases all MentorMate AI conversation history
                </p>
                <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span> 
                  Clears timers, session records & study stats
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => setProjectToDelete(null)}
                disabled={isDeleting}
                className="w-full sm:order-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors disabled:opacity-50 cursor-pointer"
                id="cancel-delete-modal-btn"
              >
                Cancel
              </button>
              <button
                onClick={executeDeleteSession}
                disabled={isDeleting}
                className="w-full sm:order-2 py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm focus:ring-4 focus:ring-red-100 cursor-pointer"
                id="confirm-delete-modal-btn"
              >
                {isDeleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Delete File & History
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* DUPLICATE DOCUMENT MODAL POPUP */}
      {duplicateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-slate-950/60 transition-all duration-300">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full shadow-2xl border border-slate-100 dark:border-slate-800 p-6 md:p-8 space-y-6 scale-in transition-all">
            
            <div className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 p-3 rounded-full shrink-0 animate-bounce">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Duplicate Document Detected</h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs text-balance">This document has already been uploaded to your study projects.</p>
              </div>
            </div>

            <div className="space-y-3 bg-amber-50/50 dark:bg-amber-950/20 p-4 rounded-xl border border-amber-100 dark:border-amber-900/55 text-sm text-slate-700 dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-slate-200 break-words line-clamp-2">
                "{duplicateModal.filename}"
              </p>
              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 pt-2 border-t border-amber-100 dark:border-amber-900/40 font-medium font-sans">
                <p className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  Similarity Match: <span className="text-amber-700 dark:text-amber-400 font-bold bg-amber-100 dark:bg-amber-950/50 px-2 py-0.5 rounded-md">{(duplicateModal.similarity * 100).toFixed(1)}%</span>
                </p>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed pt-1">
                  To prevent clutter and save database space, duplicate uploads with 95% or higher similarity on page 1 of the document are blocked.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setDuplicateModal(null)}
                className="w-full py-3 px-4 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                id="close-duplicate-modal-btn"
              >
                Okay
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
