const DB_NAME = 'mdl-offline-scanner';
const STORE_SCANS = 'pending_scans';
const STORE_SEEN = 'seen_qr_ids';

export interface OfflineScanRecord {
  qrCodeId: string;
  eventId: number;
  ticketId: number;
  scannedAt: string;
  synced: boolean;
}

function openScannerDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SCANS)) {
        db.createObjectStore(STORE_SCANS, { keyPath: 'qrCodeId' });
      }
      if (!db.objectStoreNames.contains(STORE_SEEN)) {
        db.createObjectStore(STORE_SEEN, { keyPath: 'qrCodeId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function isQrAlreadyScannedOffline(qrCodeId: string): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  const db = await openScannerDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SEEN, 'readonly');
    const req = tx.objectStore(STORE_SEEN).get(qrCodeId);
    req.onsuccess = () => resolve(Boolean(req.result));
    req.onerror = () => reject(req.error);
  });
}

export async function recordOfflineScan(record: OfflineScanRecord): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openScannerDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_SCANS, STORE_SEEN], 'readwrite');
    tx.objectStore(STORE_SEEN).put({ qrCodeId: record.qrCodeId, scannedAt: record.scannedAt });
    tx.objectStore(STORE_SCANS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingOfflineScans(): Promise<OfflineScanRecord[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openScannerDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SCANS, 'readonly');
    const req = tx.objectStore(STORE_SCANS).getAll();
    req.onsuccess = () => resolve((req.result as OfflineScanRecord[]).filter((r) => !r.synced));
    req.onerror = () => reject(req.error);
  });
}

export async function markScansSynced(qrCodeIds: string[]): Promise<void> {
  if (typeof indexedDB === 'undefined' || qrCodeIds.length === 0) return;
  const db = await openScannerDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SCANS, 'readwrite');
    const store = tx.objectStore(STORE_SCANS);
    for (const id of qrCodeIds) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
