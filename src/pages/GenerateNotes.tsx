import React, { useState, useEffect } from "react";
import { useAuth } from "../components/AuthProvider";
import { useNavigate } from "react-router";
import { BookOpen, Upload, Link as LinkIcon, FileText, ChevronLeft, Download, Play, ZoomIn, ZoomOut, Eye, RefreshCw } from "lucide-react";
import { useStore } from "../store";
import jsPDF from "jspdf";
import ReactMarkdown from "react-markdown";
import { Document, Page, pdfjs } from "react-pdf";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Configure pdfjs worker to support local render preview
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker || `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Custom PDF generation service for clean, beautifully styled academic study notes without raw Markdown characters
const generateStyledPdf = (title: string, markdownText: string): string => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width; // 210mm (A4)
  const pageHeight = doc.internal.pageSize.height; // 297mm (A4)
  const marginX = 20;
  const contentWidth = pageWidth - (marginX * 2); // 170mm
  
  let currentY = 25;
  
  const checkPageBreak = (neededHeight: number) => {
    if (currentY + neededHeight > pageHeight - 25) {
      doc.addPage();
      currentY = 25;
    }
  };
  
  // Clean background & header elements
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text(title || "MentorMate Study Notes", marginX, currentY);
  currentY += 10;
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Generated on ${new Date().toLocaleDateString()} • Format: Academic Study Material`, marginX, currentY);
  currentY += 12;
  
  // Dynamic line separator
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.5);
  doc.line(marginX, currentY, pageWidth - marginX, currentY);
  currentY += 15;
  
  const lines = markdownText.split("\n");
  
  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") {
      currentY += 5; // Paragraph spacer
      continue;
    }
    
    // Heading 1
    if (line.startsWith("# ")) {
      const cleanText = line.substring(2).replace(/\*\*/g, "").trim();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(15, 23, 42); // slate-900
      
      const wrapped = doc.splitTextToSize(cleanText, contentWidth);
      checkPageBreak((wrapped.length * 8) + 8);
      
      for (const textPart of wrapped) {
        doc.text(textPart, marginX, currentY);
        currentY += 8;
      }
      currentY += 4;
    } 
    // Heading 2
    else if (line.startsWith("## ")) {
      const cleanText = line.substring(3).replace(/\*\*/g, "").trim();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59); // slate-800
      
      const wrapped = doc.splitTextToSize(cleanText, contentWidth);
      checkPageBreak((wrapped.length * 7) + 6);
      
      for (const textPart of wrapped) {
        doc.text(textPart, marginX, currentY);
        currentY += 7;
      }
      currentY += 3;
    } 
    // Heading 3
    else if (line.startsWith("### ")) {
      const cleanText = line.substring(4).replace(/\*\*/g, "").trim();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(51, 65, 85); // slate-700
      
      const wrapped = doc.splitTextToSize(cleanText, contentWidth);
      checkPageBreak((wrapped.length * 6) + 4);
      
      for (const textPart of wrapped) {
        doc.text(textPart, marginX, currentY);
        currentY += 6;
      }
      currentY += 2;
    } 
    // Bullet Points
    else if (line.startsWith("- ") || line.startsWith("* ")) {
      const cleanText = line.substring(2).replace(/\*\*/g, "").trim();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105); // slate-600
      
      const indentX = 8;
      const textWidth = contentWidth - indentX;
      const wrapped = doc.splitTextToSize(cleanText, textWidth);
      checkPageBreak((wrapped.length * 6) + 3);
      
      // Render filled bullet circle
      doc.setFillColor(100, 116, 139);
      doc.circle(marginX + 2, currentY - 3.5, 1, "F");
      
      for (const textPart of wrapped) {
        doc.text(textPart, marginX + indentX, currentY);
        currentY += 6;
      }
      currentY += 1;
    } 
    // Numbered lists
    else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+\.)\s(.*)/);
      const numPrefix = match ? match[1] : "1.";
      const cleanText = (match ? match[2] : line.replace(/^\d+\.\s/, "")).replace(/\*\*/g, "").trim();
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105); // slate-600
      
      const indentX = 8;
      const textWidth = contentWidth - indentX;
      const wrapped = doc.splitTextToSize(cleanText, textWidth);
      checkPageBreak((wrapped.length * 6) + 3);
      
      doc.setFont("helvetica", "bold");
      doc.text(numPrefix, marginX, currentY);
      doc.setFont("helvetica", "normal");
      
      for (const textPart of wrapped) {
        doc.text(textPart, marginX + indentX, currentY);
        currentY += 6;
      }
      currentY += 1;
    } 
    // Plain paragraphs
    else {
      const cleanText = line.replace(/\*\*/g, "").trim();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105); // slate-600
      
      const wrapped = doc.splitTextToSize(cleanText, contentWidth);
      checkPageBreak((wrapped.length * 6) + 3);
      
      for (const textPart of wrapped) {
        doc.text(textPart, marginX, currentY);
        currentY += 6;
      }
      currentY += 2;
    }
  }
  
  return doc.output("datauristring");
};

export default function GenerateNotes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const setCurrentPdf = useStore((state) => state.setCurrentPdf);
  
  const [syllabus, setSyllabus] = useState("");
  const [links, setLinks] = useState("");
  const [fileUrls, setFileUrls] = useState<string[]>([]);
  const [generatedNotes, setGeneratedNotes] = useState<string>("");
  const [loading, setLoading] = useState(false);
  
  // Custom styled PDF states
  const [createdPdfUrl, setCreatedPdfUrl] = useState<string>("");
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [activeTab, setActiveTab] = useState<"pdf" | "markdown">("pdf");

  const pdfSource = React.useMemo(() => {
    const src = createdPdfUrl;
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
      console.warn("Error decoding PDF source:", e);
      return src;
    }
  }, [createdPdfUrl]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        setFileUrls(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleGenerate = async () => {
    setLoading(true);
    setGeneratedNotes("");
    if (createdPdfUrl && createdPdfUrl.startsWith("blob:")) {
      URL.revokeObjectURL(createdPdfUrl);
    }
    setCreatedPdfUrl("");
    try {
      const response = await fetch("/api/gemini/generate-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syllabus,
          links,
          fileDataUrls: fileUrls
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate notes");
      }
      if (data.text) {
        setGeneratedNotes(data.text);
        
        // Compile styled PDF base64 right away
        const pdfDataUri = generateStyledPdf("MentorMate Study Notes", data.text);
        setCreatedPdfUrl(pdfDataUri);
        setPageNumber(1);
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to generate notes");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!createdPdfUrl) return;
    const link = document.createElement("a");
    link.href = createdPdfUrl;
    link.download = "MentorMate-Notes.pdf";
    link.click();
  };

  const handleStartSession = () => {
    if (!createdPdfUrl) return;
    setCurrentPdf(createdPdfUrl, "Generated Notes");
    navigate("/session");
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center max-w-md">
          <BookOpen className="mx-auto text-blue-500 mb-4 h-12 w-12" />
          <h2 className="text-xl font-bold mb-2">Access Restricted</h2>
          <p className="text-slate-400 text-sm mb-6">Please sign in to access the AI study note intelligence tools.</p>
          <button onClick={() => navigate("/")} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 transition text-white font-medium rounded-xl">
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-12 font-sans">
      <div className="max-w-5xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-400 hover:text-white mb-8 transition text-sm font-medium">
          <ChevronLeft size={18} /> Back to Dashboard
        </button>

        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">Generate Study Notes</h1>
        <p className="text-slate-400 text-sm mb-8">Elevate your study flow. Compile syllabus instructions and PDFs into clean academic review guides.</p>

        {!generatedNotes ? (
          <div className="space-y-6">
            <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-2">
              <label className="block text-sm font-bold text-slate-200">Syllabus or Learning Objectives (Text)</label>
              <textarea 
                className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded-xl p-4 h-36 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition placeholder-slate-600 text-sm"
                placeholder="Paste your course syllabus, lecture description, topics list, or specific concepts to guide note generation..."
                value={syllabus}
                onChange={e => setSyllabus(e.target.value)}
              />
            </div>

            <div className="bg-slate-900 p-6 rounded-2xl border-dashed border-2 border-slate-800 hover:border-slate-705 flex flex-col items-center cursor-pointer hover:bg-slate-900/60 transition relative min-h-[160px] justify-center">
              <input type="file" multiple accept="application/pdf" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={handleFileUpload} />
              <div className="bg-blue-950/40 text-blue-400 p-4 rounded-full mb-3"><Upload size={28} /></div>
              <h3 className="font-bold text-slate-100">Upload Course Slides or Materials (PDFs)</h3>
              <p className="text-xs text-slate-400 mt-1.5">{fileUrls.length} source file(s) attached</p>
            </div>

            <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-2">
              <label className="block text-sm font-bold text-slate-200">Reference URL / Supplementary Links</label>
              <textarea 
                className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded-xl p-4 h-24 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition placeholder-slate-600 text-sm"
                placeholder="Paste key study guide articles or references to fetch..."
                value={links}
                onChange={e => setLinks(e.target.value)}
              />
            </div>

            <button 
              onClick={handleGenerate}
              disabled={loading || (!syllabus && !links && fileUrls.length === 0)}
              className="w-full py-4 text-base font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 active:scale-[0.99] transition disabled:opacity-40 disabled:cursor-not-allowed shadow-lg cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="animate-spin h-5 w-5" />
                  Generating Smart Study Notes...
                </>
              ) : "Generate Smart Notes"}
            </button>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Top Bar Call-To-Action buttons, Repositioned on the starting of the page means on the top of the generated notes */}
            <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 shadow-md">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-left">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">Ready to study!</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Your bespoke study material has been beautifully formatted & compiled.</p>
                </div>
                
                <div className="flex gap-3 w-full sm:w-auto">
                  <button 
                    onClick={handleDownload} 
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-3 text-slate-200 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-xl text-sm font-bold transition cursor-pointer"
                  >
                    <Download size={16} /> Download PDF
                  </button>
                  <button 
                    onClick={handleStartSession} 
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-3 text-white bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-bold transition shadow-md cursor-pointer"
                  >
                    <Play size={16} /> Start Session
                  </button>
                </div>
              </div>
              
              {/* Layout Mode Toggles */}
              <div className="flex border-t border-slate-800/80 mt-4 pt-3 items-center justify-between">
                <div className="flex gap-2">
                  <button 
                    onClick={() => setActiveTab("pdf")} 
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${activeTab === 'pdf' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <Eye size={13} /> Interactive PDF View
                  </button>
                  <button 
                    onClick={() => setActiveTab("markdown")} 
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${activeTab === 'markdown' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <FileText size={13} /> Text Outline Format
                  </button>
                </div>
                
                {activeTab === 'pdf' && numPages > 0 && (
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setPageNumber(p => Math.max(1, p - 1))} 
                      disabled={pageNumber === 1}
                      className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-slate-800 border border-slate-700 rounded disabled:opacity-25 transition text-slate-300"
                    >
                      Prev
                    </button>
                    <span className="text-xs text-slate-400 font-medium">Page {pageNumber} / {numPages}</span>
                    <button 
                      onClick={() => setPageNumber(p => Math.min(numPages, p + 1))} 
                      disabled={pageNumber === numPages}
                      className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-slate-800 border border-slate-700 rounded disabled:opacity-25 transition text-slate-300"
                    >
                      Next
                    </button>
                    <div className="h-4 w-px bg-slate-800"></div>
                    <button onClick={() => setScale(s => Math.max(0.6, s - 0.1))} className="text-slate-400 hover:text-white p-1" title="Zoom Out"><ZoomOut size={14} /></button>
                    <button onClick={() => setScale(s => Math.min(1.5, s + 0.1))} className="text-slate-400 hover:text-white p-1" title="Zoom In"><ZoomIn size={14} /></button>
                  </div>
                )}
              </div>
            </div>

            {/* Document Content Box */}
            {activeTab === "pdf" ? (
              <div className="flex justify-center items-start bg-slate-900 border border-slate-800 p-4 md:p-8 rounded-2xl shadow-xl overflow-auto custom-scrollbar min-h-[550px]">
                {createdPdfUrl ? (
                  <div className="bg-white shadow-2xl relative w-auto h-auto min-w-[280px] max-w-full sm:min-w-[500px] md:min-w-[700px] rounded overflow-hidden select-none cursor-pointer" onClick={() => setPageNumber(p => p < numPages ? p + 1 : 1)} title="Click page to flip forward">
                    <Document
                      file={pdfSource}
                      onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                      className="flex flex-col items-center"
                      loading={
                        <div className="flex flex-col items-center justify-center p-24 text-slate-400 space-y-4">
                          <RefreshCw className="animate-spin h-8 w-8 text-blue-500" />
                          <p className="text-sm">Formatting Bespoke Academic PDF pages...</p>
                        </div>
                      }
                    >
                      <Page 
                        pageNumber={pageNumber} 
                        scale={scale} 
                        className="shadow-sm react-pdf-page" 
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                      />
                    </Document>
                    <div className="absolute bottom-2 right-3 bg-slate-950/80 backdrop-blur text-[10px] text-slate-300 py-1 px-2 rounded font-sans uppercase tracking-wider font-bold z-10">
                      Click Page to Flip
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-400 p-24 w-full">
                    <RefreshCw className="animate-spin h-8 w-8 text-blue-500 mb-4" />
                    <p className="text-sm">Preparing PDF file...</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-slate-900 p-8 rounded-2xl shadow-xl border border-slate-800">
                <div className="prose max-w-none text-slate-300 prose-invert prose-headings:text-white prose-a:text-blue-400 leading-relaxed">
                  <ReactMarkdown>{generatedNotes}</ReactMarkdown>
                </div>
              </div>
            )}
            
          </div>
        )}
      </div>
    </div>
  );
}
