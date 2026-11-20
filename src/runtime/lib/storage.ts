/**
 * Persistent storage, Emscripten's IDBFS -> IndexedDB
 */

const MOUNT = '/persist';
const KV_DIR = MOUNT + '/kv';

const toFilename = (key: string) => encodeURIComponent(key).replace(/\./g, '%2E');

export class Storage {
    constructor(private getModule: () => WebChuGLModule | null) {}

    private get fs(): EmscriptenFS {
        const module = this.getModule();
        if (!module) throw new Error('[WebChuGL] storage is unavailable before init() resolves');
        return module.FS;
    }

    /** Mount IDBFS and pull its contents into the VFS. */
    mount(): Promise<void> {
        const module = this.getModule()!;
        module.FS.mkdir(MOUNT);
        module.FS.mount(module.IDBFS, { autoPersist: true }, MOUNT);
        return this.sync(true).then(() => {
            try { module.FS.mkdir(KV_DIR); } catch { /* restored by the sync */ }
        });
    }

    private sync(populate: boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            this.fs.syncfs(populate, (err) => (err ? reject(err) : resolve()));
        });
    }

    save(key: string, value: unknown): Promise<void> {
        this.fs.writeFile(KV_DIR + '/' + toFilename(key), JSON.stringify(value));
        return this.sync(false);
    }

    load(key: string): Promise<unknown> {
        let bytes: Uint8Array;
        try { bytes = this.fs.readFile(KV_DIR + '/' + toFilename(key)); }
        catch { return Promise.resolve(undefined); }
        return Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)));
    }

    delete(key: string): Promise<void> {
        try { this.fs.unlink(KV_DIR + '/' + toFilename(key)); }
        catch { return Promise.resolve(); }
        return this.sync(false);
    }

    listKeys(): Promise<string[]> {
        const names = this.fs.readdir(KV_DIR).filter((n) => n !== '.' && n !== '..');
        return Promise.resolve(names.map(decodeURIComponent));
    }
}
