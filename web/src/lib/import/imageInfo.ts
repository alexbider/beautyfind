// Image type and pixel size from the first bytes of a file (JPEG, PNG, WebP). Used to accept only real,
// usable images from business websites: no SVG, no GIF, no icons.

export interface ImageInfo {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
}

export function imageInfo(b: Buffer): ImageInfo | null {
  if (b.length < 32) return null;
  // PNG: signature, then IHDR width/height.
  if (b.readUInt32BE(0) === 0x89504e47) return { mime: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  // WebP: RIFF....WEBP then VP8 / VP8L / VP8X.
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { mime: 'image/webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { mime: 'image/webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') return { mime: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return null;
  }
  // JPEG: walk the segments to the first SOFn marker.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** Minimum sizes: a logo at least 96px on its short side, a listing photo at least 480x320. */
export function usable(info: ImageInfo, as: 'logo' | 'photo'): boolean {
  if (as === 'logo') return Math.min(info.width, info.height) >= 96;
  const ratio = info.width / info.height;
  return info.width >= 480 && info.height >= 320 && ratio > 0.5 && ratio < 3.2;
}
