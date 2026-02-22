// Minimal JSZip type definitions for WebChuGL.
// JSZip is loaded as a global via <script> tag, not imported as a module.

declare class JSZip {
    static loadAsync(data: ArrayBuffer): Promise<JSZipObject>;
}

interface JSZipObject {
    files: Record<string, JSZipEntry>;
}

interface JSZipEntry {
    dir: boolean;
    async(type: 'arraybuffer'): Promise<ArrayBuffer>;
}
