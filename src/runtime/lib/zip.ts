/**
 * zip utilities
 */

interface ZipEntry {
    name: string;
    /** Offset of the local file header */
    headerOffset: number;
    compression: number;
    compressedSize: number;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN = 22;
// A zip comment is a uint16 length, so the EOCD starts at most this far back.
const EOCD_MAX_SEARCH = EOCD_MIN + 0xffff;

export class Zip {
    /** Entry names in central-directory order, directories excluded. */
    readonly names: string[];

    private constructor(
        private _bytes: Uint8Array<ArrayBuffer>,
        private _entries: Map<string, ZipEntry>,
    ) {
        this.names = [...this._entries.keys()];
    }

    static read(data: ArrayBuffer): Zip {
        const bytes = new Uint8Array(data);
        const view = new DataView(data);
        const entries = new Map<string, ZipEntry>();
        const decoder = new TextDecoder();

        let eocd = -1;
        const limit = Math.max(0, bytes.length - EOCD_MAX_SEARCH);
        for (let i = bytes.length - EOCD_MIN; i >= limit; i--) {
            if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');

        const count = view.getUint16(eocd + 10, true);
        let p = view.getUint32(eocd + 16, true);
        if (p === 0xffffffff) throw new Error('Zip64 archives are not supported');

        for (let i = 0; i < count; i++) {
            if (view.getUint32(p, true) !== CENTRAL_SIG) {
                throw new Error('Malformed zip: bad central directory entry at ' + p);
            }
            const compression = view.getUint16(p + 10, true);
            const compressedSize = view.getUint32(p + 20, true);
            const nameLen = view.getUint16(p + 28, true);
            const extraLen = view.getUint16(p + 30, true);
            const commentLen = view.getUint16(p + 32, true);
            const headerOffset = view.getUint32(p + 42, true);
            const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

            // Trailing '/' is how a zip marks a directory
            if (!name.endsWith('/')) {
                if (compressedSize === 0xffffffff || headerOffset === 0xffffffff) {
                    throw new Error('Zip64 entry is not supported: ' + name);
                }
                entries.set(name, { name, headerOffset, compression, compressedSize });
            }
            p += 46 + nameLen + extraLen + commentLen;
        }

        return new Zip(bytes, entries);
    }

    file(name: string): Promise<ArrayBuffer> {
        const entry = this._entries.get(name);
        if (!entry) return Promise.reject(new Error('No such entry in zip: ' + name));

        const view = new DataView(this._bytes.buffer, this._bytes.byteOffset);
        if (view.getUint32(entry.headerOffset, true) !== LOCAL_SIG) {
            return Promise.reject(new Error('Malformed zip: bad local header for ' + name));
        }
        const nameLen = view.getUint16(entry.headerOffset + 26, true);
        const extraLen = view.getUint16(entry.headerOffset + 28, true);
        const start = entry.headerOffset + 30 + nameLen + extraLen;
        const raw = this._bytes.subarray(start, start + entry.compressedSize);

        if (entry.compression === 0) {
            return Promise.resolve(raw.slice().buffer);
        }
        if (entry.compression !== 8) {
            return Promise.reject(new Error(
                'Unsupported zip compression method ' + entry.compression + ' for ' + name));
        }
        return new Response(
            new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
        ).arrayBuffer();
    }
}
