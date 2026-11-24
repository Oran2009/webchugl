/**
 * Emscripten filesystem - default is MEMFS (non-persistent, in-memory filesystem)
 * IDBFS (persistent) is mounted at /persist
 * - includes chudata and kv
 */

const MOUNT = '/persist';
const CHUDATA_DIR = MOUNT + "/chudata";
const KV_DIR = MOUNT + '/kv';

const BINARY_EXTS = /\.(wasm|wav|mp3|ogg|flac|aiff|aif|png|jpg|jpeg|gif|bmp|webp|tga|hdr|obj|mtl|glb|gltf|bin|dat|zip)$/i;

const toFilename = (key: string) => encodeURIComponent(key).replace(/\./g, '%2E');

export const abs = (path: string) => (path[0] === '/' ? path : '/' + path);

export function isBinaryFile(path: string): boolean {
    return BINARY_EXTS.test(path);
}

export class VFS {
    constructor(private _getModule: () => WebChuGLModule | null) {}

    private get _fs(): EmscriptenFS {
        const module = this._getModule();
        if (!module) throw new Error('[WebChuGL] the filesystem is unavailable before init() resolves');
        return module.FS;
    }

    // mount idbfs
    mount(): Promise<void> {
        const module = this._getModule()!;
        module.FS.mkdir(MOUNT); // persistent root - /persist/
        module.FS.mount(module.IDBFS, { autoPersist: true }, MOUNT);
        return this._sync(true).then(() => {
            try {
                module.FS.mkdir(CHUDATA_DIR); // persistent chudata dir - /persist/chudata/
                module.FS.mkdir(KV_DIR); // persistent kv dir - /persist/kv/
            } catch {}
        });
    }

    private _sync(populate: boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            this._fs.syncfs(populate, (err) => (err ? reject(err) : resolve()));
        });
    }

    private _mkdirp(path: string): void {
        const parts = path.split('/').slice(0, -1);
        let current = '';
        for (let i = 0; i < parts.length; i++) {
            if (!parts[i]) continue;
            current += '/' + parts[i];
            try { this._fs.mkdir(current); } catch {}
        }
    }

    write(path: string, data: string | ArrayBuffer | Uint8Array): void {
        path = abs(path);
        this._mkdirp(path);
        this._fs.writeFile(path,
            typeof data === 'string' ? data : new Uint8Array(data as ArrayBuffer));
    }

    exists(path: string): boolean {
        try { this._fs.stat(abs(path)); return true; } catch { return false; }
    }

    // remove a file or directory recursively
    remove(path: string): boolean {
        path = abs(path);
        try {
            if (this._fs.isDir(this._fs.stat(path).mode)) {
                for (const entry of this._readdir(path)) this.remove(path + '/' + entry);
                this._fs.rmdir(path);
            } else {
                this._fs.unlink(path);
            }
            return true;
        } catch { return false; }
    }

    // list files in `dir` recursively.
    list(dir: string): string[] {
        dir = abs(dir);
        const results: string[] = [];
        for (const entry of this._readdir(dir)) {
            const full = dir + '/' + entry;
            if (this._fs.isDir(this._fs.stat(full).mode)) results.push(...this.list(full));
            else results.push(full);
        }
        return results;
    }

    private _readdir(dir: string): string[] {
        try { return this._fs.readdir(dir).filter((e) => e !== '.' && e !== '..'); }
        catch { return []; }
    }

    // key-value

    save(key: string, value: unknown): Promise<void> {
        this._fs.writeFile(KV_DIR + '/' + toFilename(key), JSON.stringify(value));
        return this._sync(false);
    }

    load(key: string): Promise<unknown> {
        let bytes: Uint8Array;
        try { bytes = this._fs.readFile(KV_DIR + '/' + toFilename(key)); }
        catch { return Promise.resolve(undefined); }
        return Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)));
    }

    delete(key: string): Promise<void> {
        try { this._fs.unlink(KV_DIR + '/' + toFilename(key)); }
        catch { return Promise.resolve(); }
        return this._sync(false);
    }

    listKeys(): Promise<string[]> {
        return Promise.resolve(this._readdir(KV_DIR).map(decodeURIComponent));
    }
}
