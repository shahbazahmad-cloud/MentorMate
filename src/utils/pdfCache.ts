const DB_NAME = 'pdf-cache-db';
const STORE_NAME = 'pdfs';

export function initPdfDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open database'));
  });
}

export async function savePdfToCache(key: string, dataUrl: string): Promise<void> {
  if (!key || !dataUrl) return;
  try {
    const db = await initPdfDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(dataUrl, key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Transaction error'));
    });
  } catch (err) {
    console.error('Failed to save to IndexedDB cache:', err);
  }
}

export async function getPdfFromCache(key: string): Promise<string | null> {
  if (!key) return null;
  try {
    const db = await initPdfDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Get request error'));
    });
  } catch (err) {
    console.error('Failed to read from IndexedDB cache:', err);
    return null;
  }
}

export async function deletePdfFromCache(key: string): Promise<void> {
  if (!key) return;
  try {
    const db = await initPdfDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Transaction error'));
    });
  } catch (err) {
    console.error('Failed to delete from IndexedDB cache:', err);
  }
}

