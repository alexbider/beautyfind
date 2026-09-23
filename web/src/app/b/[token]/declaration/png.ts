import { inflateSync } from 'node:zlib';

// Server re-check of the signature image: a real PNG, under the size cap, with at least one
// non-transparent pixel. A blank canvas exports as a valid PNG whose pixel data is all zeros.

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export type PngCheck = { ok: true; width: number; height: number } | { ok: false; error: 'not_png' | 'too_big' | 'empty' };

export function checkSignaturePng(buf: Buffer, maxBytes: number): PngCheck {
  if (buf.length > maxBytes) return { ok: false, error: 'too_big' };
  if (buf.length < 60 || !buf.subarray(0, 8).equals(SIG)) return { ok: false, error: 'not_png' };

  let off = 8;
  let width = 0, height = 0, depth = 8, colorType = 6, interlace = 0;
  const idat: Buffer[] = [];
  try {
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      const data = buf.subarray(off + 8, off + 8 + len);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        depth = data[8];
        colorType = data[9];
        interlace = data[12];
      } else if (type === 'IDAT') {
        idat.push(data);
      } else if (type === 'IEND') {
        break;
      }
      off += 12 + len;
    }
    if (!width || !height || width > 4000 || height > 2000 || !idat.length || !(colorType in CHANNELS)) return { ok: false, error: 'not_png' };
    const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: 64 * 1024 * 1024 });

    // Filtered scanlines: all-zero data bytes decode to an all-zero (fully transparent) image
    // under every PNG filter, so any non-zero data byte means there is ink.
    if (interlace) return raw.some(b => b !== 0) ? { ok: true, width, height } : { ok: false, error: 'empty' };
    const stride = 1 + Math.ceil((width * CHANNELS[colorType] * depth) / 8);
    for (let row = 0; row < height; row++) {
      const start = row * stride + 1;
      const end = Math.min(start + stride - 1, raw.length);
      for (let i = start; i < end; i++) if (raw[i] !== 0) return { ok: true, width, height };
    }
    return { ok: false, error: 'empty' };
  } catch {
    return { ok: false, error: 'not_png' };
  }
}
