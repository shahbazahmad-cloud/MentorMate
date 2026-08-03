import { doc, deleteDoc, collection, getDocs, writeBatch } from "firebase/firestore";
import { db } from "../lib/firebase";
import { deletePdfFromCache } from "./pdfCache";

export async function deleteFileAndHistory(sessionId: string, filename?: string): Promise<void> {
  if (!sessionId) return;

  try {
    // Delete any PDF chunks subcollection documents
    const chunksSnapshot = await getDocs(collection(db, "sessions", sessionId, "pdfChunks"));
    if (!chunksSnapshot.empty) {
      const batch = writeBatch(db);
      chunksSnapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
    }
  } catch (err) {
    console.error("Error deleting PDF chunks subcollection:", err);
  }

  // 1. Remove session document from Firestore containing history, chats, and metadata
  await deleteDoc(doc(db, "sessions", sessionId));

  // 2. Remove binary PDF cache from IndexedDB
  await deletePdfFromCache(sessionId);
  if (filename) {
    await deletePdfFromCache(filename);
  }
}

