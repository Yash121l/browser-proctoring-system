/**
 * EventStore
 * Minimal IndexedDB-backed queue for offline events.
 * - Object store: "events" with auto-increment key.
 * - Methods: enqueue, getAll, remove
 *
 * Security: Stores only event payloads; ensure no secrets are persisted unnecessarily.
 */
export class EventStore {
  private dbName: string;
  private version: number;
  private db?: IDBDatabase;

  constructor(dbName: string, version: number) {
    this.dbName = dbName;
    this.version = version;
  }

  private getDB(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("events")) {
          db.createObjectStore("events", { keyPath: "_id", autoIncrement: true });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * enqueue
   * Adds an event payload to the offline queue.
   */
  async enqueue(payload: any): Promise<number> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("events", "readwrite");
      const store = tx.objectStore("events");
      const r = store.add(payload);
      r.onsuccess = () => resolve(r.result as number);
      r.onerror = () => reject(r.error);
    });
  }

  /**
   * getAll
   * Returns all queued items.
   */
  async getAll(): Promise<any[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const store = tx.objectStore("events");
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result as any[]);
      r.onerror = () => reject(r.error);
    });
  }

  /**
   * remove
   * Deletes a queued item by key.
   */
  async remove(id: number): Promise<void> {
    const db = await this.getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("events", "readwrite");
      const store = tx.objectStore("events");
      const r = store.delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }
}

