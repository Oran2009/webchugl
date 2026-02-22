const BINARY_EXTS = /\.(wasm|wav|mp3|ogg|flac|aiff|aif|png|jpg|jpeg|gif|bmp|webp|tga|hdr|obj|mtl|glb|gltf|bin|dat|zip)$/i;

export function isBinaryFile(path: string): boolean {
    return BINARY_EXTS.test(path);
}

export function ensureVfsDir(fs: EmscriptenFS, path: string): void {
    const parts = path.split('/').slice(0, -1);
    let current = '';
    for (let i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        current += '/' + parts[i];
        try { fs.mkdir(current); } catch { /* directory may already exist */ }
    }
}
