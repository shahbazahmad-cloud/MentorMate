import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../components/AuthProvider";
import { useNavigate } from "react-router";
import { useStore } from "../store";
import { Clock, ChevronLeft, Play, Pause, Square, Mic, MicOff, Settings, Send, ZoomIn, ZoomOut, Volume2, Sun, Moon, Trash2, AlertTriangle } from "lucide-react";
import { formatTime } from "../utils";
import ReactMarkdown from "react-markdown";
import { addDoc, collection, serverTimestamp, doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { AudioStreamPlayer, pcmToBase64 } from "../lib/audio";
import { savePdfToCache, getPdfFromCache } from "../utils/pdfCache";
import { savePdfForSession, loadPdfForSession } from "../utils/pdfStorage";
import { deleteFileAndHistory } from "../utils/deleteService";

import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker || `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// --- TTS Helpers ---
function appendOrUpdateTranscript(existingText: string, newChunk: string): string {
  if (!existingText) return newChunk;
  if (!newChunk) return existingText;

  const trimmedExisting = existingText.trim();
  const trimmedNew = newChunk.trim();

  // If newChunk is a cumulative update that includes existingText
  if (trimmedNew.startsWith(trimmedExisting)) {
    return newChunk;
  }

  // If existingText already ends with newChunk (e.g. repeated event), keep existing
  if (trimmedExisting.endsWith(trimmedNew)) {
    return existingText;
  }

  const startsWithPunctuation = /^[.,!?;:]/.test(trimmedNew);
  const needsSpace = !existingText.endsWith(' ') && !existingText.endsWith('\n') && !startsWithPunctuation;

  return existingText + (needsSpace ? ' ' : '') + newChunk;
}

function cleanTextForSpeech(text: string): string {
  if (!text) return "";
  return text
    .replace(/```[\s\S]*?```/g, ' ')               // remove code blocks
    .replace(/`([^`]+)`/g, '$1')                   // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')       // link text
    .replace(/https?:\/\/\S+/g, '')                // raw URLs
    .replace(/e\.g\./gi, 'for example')
    .replace(/i\.e\./gi, 'that is')
    .replace(/etc\./gi, 'etcetera')
    .replace(/&/g, 'and')
    .replace(/%/g, 'percent')
    .replace(/=/g, 'equals')
    .replace(/\+/g, 'plus')
    .replace(/[*#_~>]/g, ' ')                      // markdown symbols
    .replace(/^[-\*\+]\s+/gm, '')                  // list bullets
    .replace(/^\d+\.\s+/gm, '')                    // numbered list
    .replace(/[:;]/g, '. ')                        // colons/semicolons to periods for natural pauses
    .replace(/[\(\)]/g, ', ')                      // parens to comma pauses
    .replace(/[\/\\]/g, ' or ')                    // slashes to "or"
    .replace(/\n+/g, '. ')                         // linebreaks to pauses
    .replace(/\s+/g, ' ')                          // collapse spaces
    .replace(/\.+/g, '.')                          // collapse multiple periods
    .trim();
}

function getBestVoice(aiVoice: 'brit' | 'american' | 'none'): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const isBrit = aiVoice === 'brit';
  const targetLang = isBrit ? 'en-gb' : 'en-us';

  const preferredNames = isBrit
    ? ['google uk english female', 'google uk english male', 'google uk english', 'hazel', 'george', 'daniel', 'serena', 'martha', 'kate', 'oliver', 'en-gb', 'united kingdom']
    : ['google us english', 'zira', 'samantha', 'jenny', 'guy', 'aria', 'ava', 'alex', 'david', 'victoria', 'en-us', 'united states'];

  // 1. Try finding an exact accent match with a preferred natural voice name
  const matchedPreferred = voices.find(v => {
    const nameLower = v.name.toLowerCase();
    const langLower = v.lang.toLowerCase().replace('_', '-');
    return langLower.includes(targetLang) && preferredNames.some(p => nameLower.includes(p));
  });
  if (matchedPreferred) return matchedPreferred;

  // 2. Try finding any voice matching exact target lang
  const exactLangMatch = voices.find(v => {
    const langLower = v.lang.toLowerCase().replace('_', '-');
    return langLower === targetLang || langLower.startsWith(targetLang);
  });
  if (exactLangMatch) return exactLangMatch;

  // 3. Fallback to any english voice matching preferred names
  const preferredEnglish = voices.find(v => {
    const nameLower = v.name.toLowerCase();
    const langLower = v.lang.toLowerCase();
    return langLower.startsWith('en') && preferredNames.some(p => nameLower.includes(p));
  });
  if (preferredEnglish) return preferredEnglish;

  // 4. Fallback to any English voice
  return voices.find(v => v.lang.toLowerCase().startsWith('en')) || voices[0] || null;
}

export default function InteractiveSession() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { currentPdfDataUrl, currentPdfName, currentSessionId, interactiveTimer, isSessionActive, incrementTimer, setTimer, startSession, pauseSession, endSession, aiVoice, setAiVoice, setCurrentPdf } = useStore();

  const [pdfTheme, setPdfTheme] = useState<'light' | 'dark'>('dark');
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'ai', text: string, isFinal?: boolean, committedText?: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [sessionDbId, setSessionDbId] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteCurrentSession = async () => {
    const targetId = sessionDbId || currentSessionId;
    setIsDeleting(true);
    try {
      if (targetId) {
        await deleteFileAndHistory(targetId, currentPdfName || undefined);
      }
      endSession();
      setCurrentPdf(null, null, null);
      navigate("/", { replace: true });
    } catch (err) {
      console.error("Failed to delete session", err);
      alert("Failed to delete session and file history. Please try again.");
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState(1.0);

  const pdfSource = React.useMemo(() => {
    const src = currentPdfDataUrl;
    if (!src) return null;
    if (typeof src === 'string' && (src.startsWith("http://") || src.startsWith("https://"))) {
      return src;
    }
    if (typeof src === 'object' && src !== null && 'data' in (src as object)) {
      return src;
    }
    try {
      let base64 = src as string;
      if (base64.includes(",")) {
        base64 = base64.split(",")[1];
      }
      base64 = base64.replace(/\s/g, "");
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return { data: bytes };
    } catch (e) {
      console.warn("Error decoding PDF base64 source:", e);
      return src;
    }
  }, [currentPdfDataUrl]);

  const handleManualPdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const result = reader.result as string;
      await savePdfToCache(file.name, result);
      if (sessionDbId || currentSessionId) {
        await savePdfToCache((sessionDbId || currentSessionId)!, result);
      }
      setCurrentPdf(result, file.name, sessionDbId || currentSessionId || undefined);
      setPdfLoadError(null);
    };
    reader.readAsDataURL(file);
  };

  // Scroll ref
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, isAiTyping]);

  const [voicesLoaded, setVoicesLoaded] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const updateVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          setVoicesLoaded(true);
        }
      };
      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
      return () => {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.onvoiceschanged = null;
        }
      };
    }
  }, []);

  // --- TTS ---
  const speak = useCallback((text: string) => {
    if (aiVoice === "none" || !text) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    try {
      window.speechSynthesis.cancel(); // Stop any active speech immediately

      const cleaned = cleanTextForSpeech(text);
      if (!cleaned) return;

      const voice = getBestVoice(aiVoice);

      // Chunk into logical sentence pieces for smooth sequential playback
      const rawChunks = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
      const chunks = rawChunks.map(c => c.trim()).filter(Boolean);

      if (chunks.length === 0) return;

      let currentIdx = 0;

      const playNextChunk = () => {
        if (currentIdx >= chunks.length) return;

        const currentText = chunks[currentIdx];
        const utterance = new SpeechSynthesisUtterance(currentText);

        utterance.lang = aiVoice === "brit" ? "en-GB" : "en-US";
        utterance.rate = 0.92; // Clear, articulate, natural cadence
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        if (voice) {
          utterance.voice = voice;
        }

        utterance.onend = () => {
          currentIdx++;
          if (currentIdx < chunks.length) {
            playNextChunk();
          }
        };

        utterance.onerror = (err) => {
          console.warn("Speech utterance error:", err);
          currentIdx++;
          if (currentIdx < chunks.length) {
            playNextChunk();
          }
        };

        try {
          window.speechSynthesis.resume();
          window.speechSynthesis.speak(utterance);
        } catch (e) {
          console.warn("Speak error:", e);
        }
      };

      // Slight timeout to let browser synthesis engine reset after cancel()
      setTimeout(() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.resume();
          playNextChunk();
        }
      }, 60);

    } catch (err) {
      console.warn("Speech synthesis error:", err);
    }
  }, [aiVoice, voicesLoaded]);

  // Sync refs for latest state during async/unmount operations
  const chatMessagesRef = useRef(chatMessages);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  const pageNumberRef = useRef(pageNumber);
  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);

  const sessionDbIdRef = useRef(sessionDbId);
  useEffect(() => {
    sessionDbIdRef.current = sessionDbId;
  }, [sessionDbId]);

  const persistSessionToDb = useCallback((msgsToSave?: typeof chatMessages, pageToSave?: number) => {
    const targetDbId = sessionDbIdRef.current || currentSessionId;
    const targetMsgs = msgsToSave || chatMessagesRef.current;
    const targetPage = typeof pageToSave === 'number' ? pageToSave : pageNumberRef.current;
    if (targetDbId && targetMsgs && targetMsgs.length > 0) {
      updateDoc(doc(db, "sessions", targetDbId), {
        chatMessages: targetMsgs,
        lastPage: targetPage,
        duration: useStore.getState().interactiveTimer,
        updatedAt: new Date().toISOString()
      }).catch(console.error);
    }
  }, [currentSessionId]);

  // Sync lastPage to Firestore whenever pageNumber changes
  useEffect(() => {
    const currentDbId = sessionDbId || currentSessionId;
    if (currentDbId && pageNumber > 0) {
      updateDoc(doc(db, "sessions", currentDbId), {
        lastPage: pageNumber,
        updatedAt: new Date().toISOString()
      }).catch(err => console.error("Error updating lastPage:", err));
    }
  }, [pageNumber, sessionDbId, currentSessionId]);

  // --- Voice / Live Conversation ---
  const [isLiveActive, setIsLiveActive] = useState(false);
  const liveWsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const audioPlayerRef = useRef<AudioStreamPlayer | null>(null);

  const startVoiceConversation = useCallback(async () => {
    if (isLiveActive || liveWsRef.current) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/live`);
    liveWsRef.current = ws;

    ws.onopen = () => {
        setIsLiveActive(true);
        ws.send(JSON.stringify({ 
             type: 'init', 
             voice: aiVoice,
             context: `Note: The user is studying a PDF named ${currentPdfName}. They are currently viewing page ${pageNumberRef.current}.`
        }));
        // Send initial frame
        setTimeout(() => {
            const canvas = document.querySelector('.react-pdf-page canvas') as HTMLCanvasElement;
            if (canvas && ws.readyState === WebSocket.OPEN) {
                const base64 = canvas.toDataURL('image/jpeg', 0.8);
                ws.send(JSON.stringify({ 
                    type: 'page_image', 
                    image: base64.split(',')[1],
                    mimeType: 'image/jpeg'
                }));
            }
        }, 500);
    };

    const audioPlayer = new AudioStreamPlayer();
    audioPlayer.init();
    audioPlayerRef.current = audioPlayer;

    const inputAudioCtx = new AudioContext({ sampleRate: 16000 });
    inputAudioCtxRef.current = inputAudioCtx;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = inputAudioCtx.createMediaStreamSource(stream);
        const processor = inputAudioCtx.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(inputAudioCtx.destination);

        processor.onaudioprocess = (e) => {
            if (ws.readyState === WebSocket.OPEN) {
               const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
               ws.send(JSON.stringify({ audio: base64 }));
            }
        };
    } catch (e) {
        console.error("Mic error:", e);
        setIsLiveActive(false);
    }

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.audio) {
            audioPlayer.playAudioChunk(msg.audio);
        }
        if (msg.rawMessage) {
            console.log("Live API Message:", msg.rawMessage);
            const serverContent = msg.rawMessage.serverContent;

            // Finalize user message when AI starts sending content
            if (serverContent?.outputTranscription || serverContent?.modelTurn?.parts?.some((p: any) => p.text)) {
                setChatMessages(prev => {
                    if (prev.length > 0 && prev[prev.length - 1].role === 'user' && !prev[prev.length - 1].isFinal) {
                        const copy = [...prev];
                        copy[copy.length - 1] = { ...copy[copy.length - 1], isFinal: true };
                        persistSessionToDb(copy);
                        return copy;
                    }
                    return prev;
                });
            }

            // Handle AI Text deltas from modelTurn (if any)
            if (serverContent?.modelTurn) {
                const textParts = serverContent.modelTurn.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('') || '';
                if (textParts) {
                    setChatMessages(prev => {
                        const copy = [...prev];
                        if (copy.length > 0 && copy[copy.length - 1].role === 'ai' && !copy[copy.length - 1].isFinal) {
                            copy[copy.length - 1] = { 
                                ...copy[copy.length - 1], 
                                text: appendOrUpdateTranscript(copy[copy.length - 1].text, textParts)
                            };
                        } else {
                            copy.push({ role: 'ai', text: textParts, isFinal: false });
                            setIsAiTyping(true);
                        }
                        return copy;
                    });
                }
            }

            // Handle AI Voice Output Transcription
            if (serverContent?.outputTranscription) {
               const aiVoiceText = serverContent.outputTranscription.text || '';
               if (aiVoiceText) {
                    setChatMessages(prev => {
                        const copy = [...prev];
                        if (copy.length > 0 && copy[copy.length - 1].role === 'ai' && !copy[copy.length - 1].isFinal) {
                            copy[copy.length - 1] = {
                                ...copy[copy.length - 1],
                                text: appendOrUpdateTranscript(copy[copy.length - 1].text, aiVoiceText)
                            };
                        } else {
                            copy.push({ role: 'ai', text: aiVoiceText, isFinal: false });
                            setIsAiTyping(true);
                        }
                        return copy;
                    });
               }
            }

            // Handle User Voice
            if (serverContent?.inputTranscription) {
               const userVoiceText = serverContent.inputTranscription.text || '';
               if (userVoiceText) {
                    setChatMessages(prev => {
                        const copy = [...prev];
                        if (copy.length > 0 && copy[copy.length - 1].role === 'user' && !copy[copy.length - 1].isFinal) {
                            copy[copy.length - 1] = {
                                ...copy[copy.length - 1],
                                text: appendOrUpdateTranscript(copy[copy.length - 1].text, userVoiceText)
                            };
                        } else {
                            copy.push({ role: 'user', text: userVoiceText, isFinal: false });
                        }
                        return copy;
                    });
               }
            }
            if (serverContent?.turnComplete) {
                setIsAiTyping(false);
                setChatMessages(prev => {
                     const copy = [...prev];
                     if (copy.length > 0) {
                         copy[copy.length - 1] = { ...copy[copy.length - 1], isFinal: true };
                     }
                     persistSessionToDb(copy);
                     return copy;
                });
            }
        }
        if (msg.interrupted) {
            audioPlayerRef.current?.stop();
            setIsAiTyping(false);
            setChatMessages(prev => {
                 const copy = [...prev];
                 if (copy.length > 0) {
                     copy[copy.length - 1] = { ...copy[copy.length - 1], isFinal: true };
                 }
                 persistSessionToDb(copy);
                 return copy;
            });
        }
    };

    ws.onclose = () => {
        setIsLiveActive(false);
        liveWsRef.current = null;
        persistSessionToDb();
    };
  }, [aiVoice, currentPdfName, persistSessionToDb]);

  const stopVoiceConversation = useCallback(() => {
     liveWsRef.current?.close();
     liveWsRef.current = null;
     inputAudioCtxRef.current?.close();
     inputAudioCtxRef.current = null;
     audioPlayerRef.current?.close();
     audioPlayerRef.current = null;
     setIsLiveActive(false);
     persistSessionToDb();
  }, [persistSessionToDb]);

  const toggleVoiceConversation = async () => {
    if (isLiveActive) {
       stopVoiceConversation();
    } else {
       await startVoiceConversation();
    }
  };

  // Auto start & Session Restoration
  useEffect(() => {
    const greetingText = "Hello! I'm MentorMate AI. I'm ready to help you study. What would you like to discuss from your notes today?";

    const initializeSession = async () => {
      let activePdfUrl = currentPdfDataUrl;
      let activeSessionId = currentSessionId;
      const savedSessionId = localStorage.getItem("lastActiveSessionId");

      // Handle page refresh or direct navigation if currentPdfDataUrl was cleared from store
      if (!activePdfUrl && user && savedSessionId) {
        try {
          const docSnap = await getDoc(doc(db, "sessions", savedSessionId));
          if (docSnap.exists()) {
            const data = docSnap.data();
            const restoredPdf = await loadPdfForSession(savedSessionId, data);
            if (restoredPdf) {
              activePdfUrl = restoredPdf;
              activeSessionId = savedSessionId;
              setCurrentPdf(restoredPdf, data.filename || "Study Session", savedSessionId);
            }
          }
        } catch (err) {
          console.error("Error restoring session from Firestore on refresh:", err);
        }
      }

      if (!activePdfUrl) {
        navigate("/");
        return;
      }

      // Check if resuming existing session
      if (user && activeSessionId) {
        setSessionDbId(activeSessionId);
        localStorage.setItem("lastActiveSessionId", activeSessionId);
        getDoc(doc(db, "sessions", activeSessionId)).then((docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.started !== true) {
              updateDoc(doc(db, "sessions", activeSessionId), { started: true }).catch(console.error);
            }
            if (data.chatMessages && Array.isArray(data.chatMessages) && data.chatMessages.length > 0) {
              setChatMessages(data.chatMessages as any);
            } else {
              setChatMessages([{ role: 'ai', text: greetingText, isFinal: true }]);
            }
            if (data.lastPage && typeof data.lastPage === 'number') {
              setPageNumber(data.lastPage);
            }
            if (data.duration) {
              setTimer(data.duration);
            }
          }
        });
      } else if (user) {
        setChatMessages([{ role: 'ai', text: greetingText, isFinal: true }]);

        // Save session start to Firestore with cloud PDF storage
        addDoc(collection(db, "sessions"), {
          userId: user.uid,
          filename: currentPdfName || "Untitled Session",
          duration: 0,
          startedAt: new Date().toISOString(),
          pdfData: "saving...",
          chatMessages: [{ role: 'ai', text: greetingText, isFinal: true }],
          lastPage: 1,
          started: true
        }).then(async (docRef) => {
          setSessionDbId(docRef.id);
          localStorage.setItem("lastActiveSessionId", docRef.id);
          const { pdfData } = await savePdfForSession(docRef.id, activePdfUrl);
          await updateDoc(doc(db, "sessions", docRef.id), { pdfData });
        }).catch(err => console.error("Error creating session document:", err));
      } else {
        setChatMessages([{ role: 'ai', text: greetingText, isFinal: true }]);
      }

      startSession();

      // Automatically turn on mic and start live conversation by default
      setTimeout(() => {
        startVoiceConversation();
      }, 300);
    };

    initializeSession();

    const interval = setInterval(() => {
      useStore.getState().isSessionActive && useStore.getState().incrementTimer();
    }, 1000);

    return () => clearInterval(interval);
  }, [startVoiceConversation]);

  // Sync session duration on close
  useEffect(() => {
     return () => {
         // on unmount, perhaps we can update db with final duration! But without active listener, it can be tricky. We'll update duration just when ending.
     }
  }, []);

  const handleEndSession = () => {
     persistSessionToDb();
     // Quiet all Speech Synthesis immediately
      if ('speechSynthesis' in window) {
         window.speechSynthesis.cancel();
      }

      // Close all live voice connections immediately to release mic
      try {
        if (liveWsRef.current) {
          liveWsRef.current.close();
          liveWsRef.current = null;
        }
      } catch (e) {}
      try {
        if (inputAudioCtxRef.current) {
          inputAudioCtxRef.current.close();
          inputAudioCtxRef.current = null;
        }
      } catch (e) {}
      try {
        if (audioPlayerRef.current) {
          audioPlayerRef.current.close();
          audioPlayerRef.current = null;
        }
      } catch (e) {}

      setIsLiveActive(false);
      endSession();
     navigate("/");
  };

  const handlePauseToggle = () => {
      if (isSessionActive) pauseSession();
      else startSession();
  }

  useEffect(() => {
     return () => {
         persistSessionToDb();
         liveWsRef.current?.close();
         inputAudioCtxRef.current?.close();
         audioPlayerRef.current?.close();
         if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
         }
     };
  }, [persistSessionToDb]);

  // --- Chat ---
  const handleChatSubmit = async (messageStr?: string) => {
    const message = typeof messageStr === 'string' ? messageStr : chatInput;
    if (!message.trim()) return;

    const newChatList = [...chatMessages, { role: 'user' as const, text: message, isFinal: true }];
    setChatMessages(newChatList);
    setChatInput("");
    setIsAiTyping(true);

    if (isLiveActive && liveWsRef.current?.readyState === WebSocket.OPEN) {
       audioPlayerRef.current?.stop();
       setIsAiTyping(false);
       liveWsRef.current.send(JSON.stringify({ type: 'text', text: message }));
       
       const currentDbId = sessionDbId || currentSessionId;
       if (currentDbId) {
          updateDoc(doc(db, "sessions", currentDbId), { 
             chatMessages: newChatList,
             updatedAt: new Date().toISOString(),
             duration: useStore.getState().interactiveTimer
          }).catch(console.error);
       }
       return;
    }

    const aiMessageIndex = newChatList.length;
    setChatMessages((prev) => [...prev, { role: 'ai' as const, text: "" }]);

    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          pdfDataUrl: currentPdfDataUrl,
          currentPage: pageNumber
        })
      });

      if (!response.ok) {
         let errMsg = "Failed to communicate with AI";
         try {
             const errData = await response.json();
             if (errData.error) errMsg = errData.error;
         } catch(e) {}
         throw new Error(errMsg);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let aiText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";
        
        for (const line of lines) {
           const trimmedLine = line.trim();
           if (trimmedLine.startsWith('data: ')) {
               const dataStr = trimmedLine.substring(6).trim();
               if (dataStr === '[DONE]') break;
               if (!dataStr) continue;

               try {
                   const parsed = JSON.parse(dataStr);
                   if (parsed.error) {
                      throw new Error(parsed.error);
                   }
                   if (parsed.text) {
                      aiText += parsed.text;
                      setChatMessages((prev) => {
                         const copy = [...prev];
                         copy[aiMessageIndex] = { role: 'ai' as const, text: aiText };
                         return copy;
                      });
                   }
               } catch(e: any) {
                   if (e instanceof SyntaxError) {
                       console.error("error parsing json", e, dataStr);
                   } else {
                       throw e;
                   }
               }
           }
        }
      }

      const finalChatList = [...newChatList, { role: 'ai' as const, text: aiText, isFinal: true }];
      
      const currentDbId = sessionDbId || currentSessionId;
      if (currentDbId) {
         updateDoc(doc(db, "sessions", currentDbId), { 
            chatMessages: finalChatList,
            updatedAt: new Date().toISOString(),
            duration: useStore.getState().interactiveTimer
         }).catch(console.error);
      }

    } catch (err: any) {
      let errMsg = err.message || "Sorry, I had trouble processing that.";
      try {
         const parsed = JSON.parse(errMsg);
         if (parsed.error && parsed.error.message) {
            errMsg = parsed.error.message;
         }
      } catch(e){}

      setChatMessages((prev) => {
          const copy = [...prev];
          copy[aiMessageIndex] = { role: 'ai' as const, text: "**Error:** " + errMsg };
          return copy;
      });
    } finally {
      setIsAiTyping(false);
    }
  };

  return (
    <div className="h-screen w-screen transition-colors duration-200 bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden">
      
      {/* Top Navigation Bar */}
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-indigo-100">
            M
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">MentorMate</span>
        </div>
        
        {/* Global Timer (Top Centre) */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3 bg-slate-900 text-white px-5 py-2 rounded-full shadow-md">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
          <span className="font-mono text-lg font-medium tracking-widest">{formatTime(interactiveTimer)}</span>
        </div>

        <div className="flex items-center gap-3">
          <button 
            type="button"
            onClick={() => setPdfTheme(p => p === 'dark' ? 'light' : 'dark')} 
            className="flex items-center justify-center p-2 rounded-lg bg-slate-800 text-gray-300 hover:bg-slate-700 transition cursor-pointer"
            title={pdfTheme === "dark" ? "Switch PDF to Light Mode" : "Switch PDF to Dark Mode"}
            id="session-theme-toggle-btn"
          >
            {pdfTheme === "dark" ? <Sun size={18} className="text-amber-500" /> : <Moon size={18} className="text-indigo-400" />}
          </button>

          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 text-red-400 font-medium text-xs transition cursor-pointer"
            title="Delete Uploaded File & History"
            id="delete-current-file-btn"
          >
            <Trash2 size={16} />
            <span className="hidden sm:inline">Delete File & History</span>
          </button>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end hidden sm:flex">
              <span className="text-sm font-semibold dark:text-slate-100">{user?.email?.split("@")[0] || "Student"}</span>
              <span className="text-xs text-slate-400 dark:text-slate-500">Interactive Session</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 border-2 border-white dark:border-slate-800 shadow-sm overflow-hidden font-sans">
              <div className="w-full h-full bg-indigo-100 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-600 dark:text-indigo-450 font-bold">
                {user?.email?.charAt(0).toUpperCase() || "S"}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area (Interactive Session) */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
         
         {/* PDF Viewport */}
         <section className="w-full md:w-3/4 flex flex-col bg-white dark:bg-slate-950 relative h-3/4 md:h-full border-b border-slate-300 dark:border-slate-800 md:border-b-0">
            {/* PDF Toolbar */}
            <div className="h-12 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 shrink-0 font-sans">
               <div className="flex items-center gap-2 md:gap-4 overflow-hidden">
                  <button onClick={() => setPageNumber(p => Math.max(1, p - 1))} disabled={pageNumber === 1} className="text-xs md:text-sm px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 rounded disabled:opacity-30 transition dark:text-slate-300">Prev</button>
                  <span className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate max-w-[120px] sm:max-w-xs">Page {pageNumber} / {numPages || '-'} • {currentPdfName}</span>
                  <button onClick={() => setPageNumber(p => Math.min(numPages, p + 1))} disabled={pageNumber === numPages} className="text-xs md:text-sm px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 rounded disabled:opacity-30 transition dark:text-slate-300">Next</button>
               </div>
               <div className="flex items-center gap-2 md:gap-3">
                 <span className="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 w-10 text-right">{Math.round(scale * 100)}%</span>
                 <input type="range" className="w-16 md:w-24 accent-indigo-600 cursor-pointer" min="50" max="300" step="10" value={scale * 100} onChange={e => setScale(Number(e.target.value) / 100)} />
               </div>
            </div>

            {/* Interactive PDF Canvas */}
            <div className="flex-1 p-4 md:p-8 overflow-auto flex justify-center items-start scroll-smooth custom-scrollbar">
                {currentPdfDataUrl && !pdfLoadError ? (
                  <div className={`bg-white shadow-2xl relative w-auto h-auto min-w-min ${pdfTheme === 'dark' ? 'rounded-sm transition-all duration-300 invert hue-rotate-180 brightness-[0.88]' : ''}`}>
                    <div className="absolute top-0 left-0 w-1 bg-indigo-500 h-full z-10"></div>
                    <Document
                      file={pdfSource}
                      onLoadSuccess={({ numPages }) => {
                        setNumPages(numPages);
                        setPdfLoadError(null);
                      }}
                      onLoadError={(err) => {
                        console.error("Error loading PDF in InteractiveSession:", err);
                        setPdfLoadError(err.message || "Failed to load PDF document.");
                      }}
                      className="flex flex-col items-center"
                      loading={<div className="animate-pulse flex items-center justify-center p-12 md:p-24 text-slate-400">Loading Document...</div>}
                    >
                      <Page 
                        pageNumber={pageNumber} 
                        scale={scale} 
                        className="shadow-sm react-pdf-page" 
                        onRenderSuccess={() => {
                           if (isLiveActive && liveWsRef.current?.readyState === WebSocket.OPEN) {
                                const canvas = document.querySelector('.react-pdf-page canvas') as HTMLCanvasElement;
                                if (canvas) {
                                    const base64 = canvas.toDataURL('image/jpeg', 0.8);
                                    liveWsRef.current.send(JSON.stringify({ 
                                        type: 'page_image', 
                                        image: base64.split(',')[1],
                                        mimeType: 'image/jpeg'
                                    }));
                                }
                           }
                        }}
                      />
                    </Document>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center bg-slate-900/50 border border-slate-800 rounded-2xl p-8 text-center max-w-md my-auto">
                    <p className="text-rose-400 font-semibold mb-2">
                      {pdfLoadError || "No PDF document loaded"}
                    </p>
                    <p className="text-xs text-slate-400 mb-6">
                      Upload or re-select your PDF study document to continue this interactive session.
                    </p>
                    <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs py-2.5 px-5 rounded-lg transition shadow-md inline-flex items-center gap-2">
                      <span>Choose PDF File</span>
                      <input 
                        type="file" 
                        accept="application/pdf" 
                        onChange={handleManualPdfUpload} 
                        className="hidden" 
                      />
                    </label>
                  </div>
                )}
            </div>            {/* Session Controls (Bottom Center) */}
            <div className="absolute bottom-4 md:bottom-8 left-1/2 -translate-x-1/2 flex gap-3 md:gap-4 z-10 w-[95%] sm:w-auto justify-center">
              <button onClick={handlePauseToggle} className="px-4 md:px-8 py-2 md:py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full font-semibold shadow-lg hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 md:gap-2 text-[10px] md:text-sm text-slate-800 dark:text-slate-100 transition whitespace-nowrap cursor-pointer">
                  {isSessionActive ? <><div className="w-2.5 h-2.5 bg-amber-500 rounded-sm"></div> PAUSE SESSION</> : <><div className="w-2.5 h-2.5 bg-emerald-500 rounded-sm"></div> RESUME SESSION</>}
              </button>
              <button onClick={handleEndSession} className="px-4 md:px-8 py-2 md:py-3 bg-rose-600 text-white rounded-full font-semibold shadow-xl hover:bg-rose-700 active:scale-95 flex items-center gap-1.5 md:gap-2 text-[10px] md:text-sm transition-all duration-150 transform whitespace-nowrap cursor-pointer">
                  <div className="w-2.5 h-2.5 bg-white rounded-full"></div> END SESSION
              </button>
            </div>


         </section>

         {/* AI Chat Sidebar */}
         <aside className="w-full md:w-1/4 h-1/4 md:h-full bg-white dark:bg-slate-900 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 font-sans">
               <div>
                  <h2 className="font-bold text-indigo-600 dark:text-indigo-400 text-sm">MENTORMATE AI</h2>
                   <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-tighter">
                     {isLiveActive ? "Live Conversation Active..." : "Gemini Intelligence Active"}
                   </p>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar font-sans">
               {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                     <div className={`max-w-[90%] p-3 rounded-2xl text-sm shadow-sm ${msg.role === 'user' ? 'bg-slate-900 dark:bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-100 dark:bg-slate-800/90 text-slate-900 dark:text-slate-100 rounded-tl-none border border-slate-200 dark:border-slate-700/80'}`}>
                        {msg.role === 'ai' ? (
                           <div className="prose prose-sm max-w-none text-slate-900 dark:text-slate-100 dark:prose-invert prose-p:text-slate-900 dark:prose-p:text-slate-100 prose-headings:text-slate-900 dark:prose-headings:text-slate-100 prose-strong:text-slate-900 dark:prose-strong:text-slate-100 prose-code:text-slate-900 dark:prose-code:text-slate-100 prose-li:text-slate-900 dark:prose-li:text-slate-100">
                              <ReactMarkdown>{msg.text.trim()}</ReactMarkdown>
                           </div>
                        ) : (
                           msg.text.trim()
                        )}
                     </div>
                     <div className="flex items-center gap-1.5 mx-1">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{msg.role === 'user' ? 'You' : 'MentorMate AI'}</span>
                     </div>
                  </div>
               ))}
               {isAiTyping && (
                 <div className="flex flex-col gap-2 items-start font-sans">
                   <div className="flex gap-2 items-center text-[10px] text-indigo-500 dark:text-indigo-400 font-bold px-3 py-2 bg-white dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40 rounded-full w-fit shadow-sm">
                      <div className="flex gap-1">
                        <div className="w-1 h-2 bg-indigo-400 animate-pulse"></div>
                        <div className="w-1 h-3 bg-indigo-500 animate-pulse"></div>
                        <div className="w-1 h-1 bg-indigo-300 animate-pulse"></div>
                      </div>
                      AI THINKING...
                   </div>
                 </div>
               )}
               <div ref={messagesEndRef} />
            </div>

            {/* Chat Input Area */}
            <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50 shrink-0">
               <div className="flex items-center gap-2">
                  <button 
                     onClick={toggleVoiceConversation} 
                     className={`p-2.5 rounded-full border shadow-sm transition-all shrink-0 flex items-center justify-center cursor-pointer ${isLiveActive ? 'text-red-500 bg-red-50 border-red-200 animate-pulse dark:bg-red-950/40 dark:border-red-900/40' : 'text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:text-indigo-600 dark:hover:text-indigo-450 hover:border-indigo-300 dark:hover:border-indigo-700 active:scale-95'}`}
                     title={isLiveActive ? "Turn off microphone" : "Turn on microphone"}
                  >
                     {isLiveActive ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                  <div className="relative flex-1">
                     <input
                       type="text"
                       value={chatInput}
                       onChange={(e) => setChatInput(e.target.value)}
                       onKeyDown={(e) => e.key === 'Enter' && handleChatSubmit()}
                       placeholder="Ask MentorMate..."
                       className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full py-2.5 pl-4 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm text-slate-700 dark:text-slate-200 disabled:bg-slate-100 dark:disabled:bg-slate-850 disabled:opacity-70"
                     />
                     <button 
                        onClick={() => handleChatSubmit()} 
                        disabled={!chatInput.trim()} 
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 disabled:opacity-40 transition-all active:scale-90 cursor-pointer"
                        title="Send message"
                     >
                        <Send size={16} />
                     </button>
                  </div>
               </div>
            </div>
         </aside>
      </main>

      {/* CONFIRMATION DELETION MODAL */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-slate-950/70 transition-all duration-300">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full shadow-2xl border border-slate-100 dark:border-slate-800 p-6 md:p-8 space-y-6 scale-in transition-all">
            
            <div className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 p-3 rounded-full shrink-0">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Delete Uploaded File & History?</h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs">This will permanently delete this document and all associated discussion turns.</p>
              </div>
            </div>

            <div className="space-y-3 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800 text-sm text-slate-700 dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-slate-100 break-words line-clamp-2">
                "{currentPdfName || 'Current Document'}"
              </p>
              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span> 
                  Deletes main PDF document & binary cache
                </p>
                <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span> 
                  Erases all MentorMate AI conversation history ({chatMessages.length} turns)
                </p>
                <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span> 
                  Clears interactive study timer & session record
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="w-full sm:order-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors disabled:opacity-50 cursor-pointer"
                id="cancel-delete-session-modal-btn"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteCurrentSession}
                disabled={isDeleting}
                className="w-full sm:order-2 py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm focus:ring-4 focus:ring-red-100 cursor-pointer"
                id="confirm-delete-session-modal-btn"
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
    </div>
  );
}
