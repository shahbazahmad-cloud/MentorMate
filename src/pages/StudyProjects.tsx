import React, { useState, useEffect } from "react";
import { useAuth } from "../components/AuthProvider";
import { useNavigate } from "react-router";
import { BookOpen, FileText, ChevronLeft, Play, Clock, MessageSquare, Calendar, Search, AlertTriangle, Trash2, X, CheckCircle } from "lucide-react";
import { collection, query, where, getDocs, doc, deleteDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useStore } from "../store";
import { getPdfFromCache } from "../utils/pdfCache";
import { loadPdfForSession } from "../utils/pdfStorage";
import { deleteFileAndHistory } from "../utils/deleteService";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, userId?: string | null, email?: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: userId || null,
      email: email || null,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function StudyProjects() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const setCurrentPdf = useStore((state) => state.setCurrentPdf);
  const currentSessionId = useStore((state) => state.currentSessionId);
  const endSession = useStore((state) => state.endSession);
  
  const [sessions, setSessions] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Custom Modal & Toast States
  const [projectToDelete, setProjectToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      if (!loading) navigate("/");
      return;
    }

    const fetchAllSessions = async () => {
      try {
        const q = query(collection(db, "sessions"), where("userId", "==", user.uid));
        const qs = await getDocs(q);
        const data = qs.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        setSessions(data);
      } catch (err) {
        console.error("Failed to fetch all sessions", err);
        try {
          handleFirestoreError(err, OperationType.LIST, "sessions", user?.uid, user?.email);
        } catch (e) {
          // handled
        }
      } finally {
        setFetching(false);
      }
    };

    fetchAllSessions();
  }, [user, loading, navigate]);

  const handleRestartSession = async (session: any) => {
    const pdfData = await loadPdfForSession(session.id || "", session);

    if (pdfData) {
      setCurrentPdf(pdfData, session.filename, session.id);
      navigate("/session");
    } else {
      alert("Unable to load document for this session. Please upload the PDF again.");
    }
  };

  const executeDeleteSession = async () => {
    if (!projectToDelete || !user) return;
    setIsDeleting(true);
    const targetId = projectToDelete.id;
    try {
      await deleteFileAndHistory(targetId, projectToDelete.filename);
      
      // Update global store if we are currently studying the deleted document
      if (currentSessionId === targetId || useStore.getState().currentPdfName === projectToDelete.filename) {
        endSession();
        setCurrentPdf(null, null, null);
      }

      setSessions(prev => prev.filter(s => s.id !== targetId));
      setToastMessage(`"${projectToDelete.filename || 'Project'}" and all its related chat history have been permanently deleted.`);
      
      // Auto-dismiss toast
      setTimeout(() => {
        setToastMessage(null);
      }, 4000);
    } catch (err) {
      console.error("Failed to delete session Document", err);
      try {
        handleFirestoreError(err, OperationType.DELETE, `sessions/${targetId}`, user.uid, user.email);
      } catch (e) {
        alert("Permissions or database error. Could not complete deletion.");
      }
    } finally {
      setIsDeleting(false);
      setProjectToDelete(null);
    }
  };

  const filteredSessions = sessions.filter(session => 
    (session.filename || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading || (fetching && sessions.length === 0)) {
    return (
      <div className="h-screen flex flex-col items-center justify-center text-gray-500 bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
        <p className="font-medium">Loading your study projects...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-12 min-h-screen relative">
      
      {/* SUCCESS TOAST BANNER */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 bg-slate-900 text-white rounded-xl shadow-xl border border-slate-800 p-4 max-w-sm flex items-start gap-3 transition-all animate-in fade-in slide-in-from-top-4 duration-300">
          <CheckCircle className="text-emerald-500 shrink-0 mt-0.5" size={20} />
          <div className="flex-1">
            <h4 className="font-semibold text-sm">Study Project Deleted</h4>
            <p className="text-slate-400 text-xs mt-1">{toastMessage}</p>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white transition">
            <X size={16} />
          </button>
        </div>
      )}

      {/* BACK NAVIGATION */}
      <div className="flex items-center justify-between mb-8">
        <button 
          onClick={() => navigate("/")} 
          className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition btn"
          id="back-to-home-btn"
        >
          <ChevronLeft size={18} />
          Back to Dashboard
        </button>
      </div>

      {/* HEADER SECTION */}
      <header className="mb-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 dark:text-slate-100 flex items-center gap-3">
              <span className="bg-blue-600 text-white p-2.5 rounded-xl shadow-md inline-block">
                <BookOpen size={24} />
              </span>
              All Study Projects
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">Manage, resume, and review all documents you have uploaded and studied with MentorMate AI.</p>
          </div>

          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Search study projects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl py-2 px-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm text-slate-700 dark:text-slate-200 font-medium"
              id="search-projects-input"
            />
          </div>
        </div>
      </header>

      {/* STUDY PROJECTS LIST */}
      {filteredSessions.length === 0 ? (
        <div className="text-center py-24 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 px-6">
          <FileText className="mx-auto w-16 h-16 text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">No Study Projects Found</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm mx-auto">
            {searchTerm ? "No projects match your search query." : "Upload a PDF document from the home dashboard to create your first study project."}
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6" id="projects-grid">
          {filteredSessions.map((session, i) => {
            const messageCount = session.chatMessages ? session.chatMessages.length : 0;
            const studyMinutes = Math.floor((session.duration || 0) / 60);

            return (
              <div 
                key={session.id || i} 
                onClick={() => handleRestartSession(session)}
                className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-100 dark:border-slate-800 cursor-pointer shadow-sm hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition-all group relative flex flex-col justify-between"
                id={`project-card-${session.id || i}`}
              >
                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div className="bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 p-3 rounded-xl group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-600 dark:group-hover:text-white transition shadow-sm">
                      <FileText size={22} />
                    </div>
                    
                    {/* TRIGGER DELETE CONFIRMATION MODAL */}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectToDelete(session);
                      }} 
                      className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                      title="Delete Study Project"
                      id={`delete-btn-${session.id || i}`}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>

                  <h3 className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition line-clamp-2 mb-2 text-base leading-snug" title={session.filename}>
                    {session.filename || "Study Session"}
                  </h3>

                  <div className="space-y-2 mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                      <Calendar size={14} className="text-slate-400" />
                      <span>Started: {new Date(session.startedAt).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock size={14} className="text-slate-400" />
                      <span>Time Studied: {studyMinutes}m {session.duration % 60}s</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MessageSquare size={14} className="text-slate-400" />
                      <span>{messageCount} discussion turns</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-sm text-blue-600 dark:text-blue-400 font-semibold group-hover:text-blue-700 dark:group-hover:text-blue-300">
                  <span>Resume Study</span>
                  <div className="bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 p-1.5 rounded-full group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-600 dark:group-hover:text-white transition shadow-sm">
                    <Play size={14} fill="currentColor" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CUSTOM CONFIRMATION DELETION MODAL (BLURRING GLASS OVERLAY) */}
      {projectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-slate-950/60 transition-all duration-300">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full shadow-2xl border border-slate-100 dark:border-slate-800 p-6 md:p-8 space-y-6 scale-in transition-all">
            
            <div className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 p-3 rounded-full shrink-0">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Delete Study Project?</h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs">This action is permanent and cannot be undone.</p>
              </div>
            </div>

            <div className="space-y-3 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800 text-sm text-slate-700 dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-slate-100 break-words line-clamp-2">
                "{projectToDelete.filename || 'Study Session'}"
              </p>
              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span> 
                  Removes main PDF document & backing source materials
                </p>
                <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span> 
                  Erases all discussion logs & query histories
                </p>
                <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span> 
                  Deletes dynamic timers & study statistics
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => setProjectToDelete(null)}
                disabled={isDeleting}
                className="w-full sm:order-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
                id="cancel-delete-modal-btn"
              >
                Cancel
              </button>
              <button
                onClick={executeDeleteSession}
                disabled={isDeleting}
                className="w-full sm:order-2 py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm focus:ring-4 focus:ring-red-100"
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
                    Delete Project
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
