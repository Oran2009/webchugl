/** Lazy-initialized IndexedDB key-value store for persistent data. */
export class Storage {
    private dbPromise: Promise<IDBDatabase> | null = null;

    private getDB(): Promise<IDBDatabase> {
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('WebChuGL', 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('kv')) {
                    db.createObjectStore('kv');
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.error('[WebChuGL] IndexedDB error:', request.error);
                this.dbPromise = null;
                reject(request.error);
            };
        });
        return this.dbPromise;
    }

    save(key: string, value: unknown): Promise<void> {
        return this.getDB().then((db) => {
            return new Promise<void>((resolve, reject) => {
                const tx = db.transaction('kv', 'readwrite');
                const req = tx.objectStore('kv').put(value, key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        });
    }

    load(key: string): Promise<unknown> {
        return this.getDB().then((db) => {
            return new Promise<unknown>((resolve, reject) => {
                const tx = db.transaction('kv', 'readonly');
                const req = tx.objectStore('kv').get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        });
    }

    delete(key: string): Promise<void> {
        return this.getDB().then((db) => {
            return new Promise<void>((resolve, reject) => {
                const tx = db.transaction('kv', 'readwrite');
                const req = tx.objectStore('kv').delete(key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        });
    }

    listKeys(): Promise<string[]> {
        return this.getDB().then((db) => {
            return new Promise<string[]>((resolve, reject) => {
                const tx = db.transaction('kv', 'readonly');
                const req = tx.objectStore('kv').getAllKeys();
                req.onsuccess = () => resolve(req.result as string[]);
                req.onerror = () => reject(req.error);
            });
        });
    }
}
