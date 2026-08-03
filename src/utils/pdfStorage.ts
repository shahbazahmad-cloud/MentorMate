import { doc, setDoc, getDocs, collection, writeBatch } from "firebase/firestore";
import { db } from "../lib/firebase";
import { getPdfFromCache, savePdfToCache } from "./pdfCache";

const CHUNK_SIZE = 400000; // ~400KB chunks to safely sit under Firestore limit

export async function savePdfForSession(sessionId: string, pdfDataUrl: string): Promise<{ pdfData: string }> {
  if (!sessionId || !pdfDataUrl) {
    return { pdfData: "" };
  }

  // Always save locally to IndexedDB for ultra-fast instant access on current device
  await savePdfToCache(sessionId, pdfDataUrl);

  // If small enough, store directly in session document
  if (pdfDataUrl.length < 700000) {
    return { pdfData: pdfDataUrl };
  }

  // If large, chunk across subcollection so it's fully backed up on cloud for all devices
  try {
    const totalChunks = Math.ceil(pdfDataUrl.length / CHUNK_SIZE);
    const chunksCollectionRef = collection(db, "sessions", sessionId, "pdfChunks");

    for (let i = 0; i < totalChunks; i++) {
      const chunkStr = pdfDataUrl.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const chunkDocRef = doc(chunksCollectionRef, i.toString());
      await setDoc(chunkDocRef, {
        index: i,
        chunkData: chunkStr
      });
    }

    return { pdfData: "stored-in-firestore-chunks" };
  } catch (err) {
    console.error("Failed to chunk and save PDF in Firestore subcollection:", err);
    // Fallback indicator
    return { pdfData: "large-pdf-stored-locally" };
  }
}

export async function loadPdfForSession(sessionId: string, sessionDocData: any): Promise<string | null> {
  if (!sessionId) return null;

  // 1. Try local IndexedDB cache first
  let cached = await getPdfFromCache(sessionId);
  if (!cached && sessionDocData?.filename) {
    cached = await getPdfFromCache(sessionDocData.filename);
  }
  if (cached && cached !== "large-pdf-stored-locally" && cached !== "stored-in-firestore-chunks") {
    return cached;
  }

  // 2. If not found in local cache, check sessionDocData from Firestore
  if (!sessionDocData) return null;

  const rawPdfData = sessionDocData.pdfData;

  // Small PDF embedded directly in the Firestore session document
  if (rawPdfData && rawPdfData.startsWith("data:")) {
    await savePdfToCache(sessionId, rawPdfData);
    if (sessionDocData.filename) {
      await savePdfToCache(sessionDocData.filename, rawPdfData);
    }
    return rawPdfData;
  }

  // Chunked PDF or legacy large PDF stored in Firestore subcollection
  if (rawPdfData === "stored-in-firestore-chunks" || rawPdfData === "large-pdf-stored-locally") {
    try {
      const querySnapshot = await getDocs(collection(db, "sessions", sessionId, "pdfChunks"));
      if (!querySnapshot.empty) {
        const chunkDocs = querySnapshot.docs.map(d => d.data());
        chunkDocs.sort((a, b) => a.index - b.index);

        const fullPdfData = chunkDocs.map(c => c.chunkData || "").join("");
        if (fullPdfData && fullPdfData.startsWith("data:")) {
          await savePdfToCache(sessionId, fullPdfData);
          if (sessionDocData.filename) {
            await savePdfToCache(sessionDocData.filename, fullPdfData);
          }
          return fullPdfData;
        }
      }
    } catch (err) {
      console.error("Failed to fetch chunked PDF from Firestore:", err);
    }
  }

  return null;
}
