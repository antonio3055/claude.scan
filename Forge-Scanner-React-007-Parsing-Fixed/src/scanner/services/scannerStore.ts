import type { ScannerDocument, ScanSettings } from '../types/scanner';

const DB_NAME = 'forge_scanner_react_v2';
const DB_VERSION = 1;
const DOCS = 'documents';
const FILES = 'files';
const SETTINGS = 'settings';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: 'fileId' });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'fileId' });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed to open.'));
  });
}

async function withStore<T>(name: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const request = run(tx.objectStore(name));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
  });
}

export const scannerStore = {
  async listDocuments(): Promise<ScannerDocument[]> {
    return withStore(DOCS, 'readonly', (store) => store.getAll()) as Promise<ScannerDocument[]>;
  },

  async saveDocument(doc: ScannerDocument) {
    await withStore(DOCS, 'readwrite', (store) => store.put(doc));
  },

  async deleteDocument(fileId: string) {
    await Promise.all([
      withStore(DOCS, 'readwrite', (store) => store.delete(fileId)),
      withStore(FILES, 'readwrite', (store) => store.delete(fileId))
    ]);
  },

  async clearCompleted(fileIds: string[]) {
    await Promise.all(fileIds.map((id) => this.deleteDocument(id)));
  },

  async saveFile(fileId: string, file: File) {
    await withStore(FILES, 'readwrite', (store) => store.put({ fileId, file }));
  },

  async getFile(fileId: string): Promise<File | null> {
    const row = await withStore<any>(FILES, 'readonly', (store) => store.get(fileId));
    return row?.file ?? null;
  },

  async getSettings(defaults: ScanSettings): Promise<ScanSettings> {
    const row = await withStore<any>(SETTINGS, 'readonly', (store) => store.get('scanner'));
    return { ...defaults, ...(row?.value ?? {}) };
  },

  async saveSettings(settings: ScanSettings) {
    await withStore(SETTINGS, 'readwrite', (store) => store.put({ key: 'scanner', value: settings }));
  }
};
