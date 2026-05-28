// 메타데이터 제거: 포맷별로 메타데이터 세그먼트/청크만 제거하고 픽셀(이미지 데이터)은 보존(무손실).
// 지원: JPEG, PNG, WebP. 그 외는 canvas 재인코딩(손실) 폴백.

// 여러 [start,end) 범위를 원본 bytes에서 잘라 하나의 Uint8Array로 합침
function assemble(bytes, ranges) {
  let total = 0;
  for (const [s, e] of ranges) total += e - s;
  const out = new Uint8Array(total);
  let off = 0;
  for (const [s, e] of ranges) {
    out.set(bytes.subarray(s, e), off);
    off += e - s;
  }
  return out;
}

function appName(marker) {
  if (marker === 0xe1) return 'EXIF/XMP (APP1)';
  if (marker === 0xe2) return 'ICC/MPF (APP2)';
  if (marker === 0xeb) return 'C2PA/JUMBF (APP11)';
  if (marker === 0xed) return 'IPTC/Photoshop (APP13)';
  if (marker === 0xfe) return '주석(COM)';
  return `APP${marker - 0xe0}`;
}

// ---------- JPEG ----------
export function stripJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('JPEG 형식이 아님');
  const removed = [];
  const ranges = [[0, 2]]; // SOI
  const len = bytes.length;
  let pos = 2;

  while (pos < len) {
    if (bytes[pos] !== 0xff) {
      ranges.push([pos, len]); // 정렬 깨짐 → 나머지 보존
      break;
    }
    let marker = bytes[pos + 1];
    while (marker === 0xff) {
      pos++;
      marker = bytes[pos + 1];
    } // fill 바이트 건너뜀

    if (marker === 0xda) {
      // SOS: 이후는 압축 스캔 데이터 → 끝까지 보존
      ranges.push([pos, len]);
      break;
    }
    if (marker === 0xd9) {
      ranges.push([pos, pos + 2]); // EOI
      pos += 2;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      ranges.push([pos, pos + 2]); // 길이 없는 standalone 마커
      pos += 2;
      continue;
    }

    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
    const fullEnd = pos + 2 + segLen;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isCom = marker === 0xfe;
    const drop = (isApp && marker !== 0xe0) || isCom; // APP0(JFIF)은 유지

    if (drop) removed.push(appName(marker));
    else ranges.push([pos, fullEnd]);
    pos = fullEnd;
  }

  return { output: assemble(bytes, ranges), removed };
}

// ---------- PNG ----------
export function stripPng(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('PNG 형식이 아님');
  const removed = [];
  const ranges = [[0, 8]];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dropTypes = {
    tEXt: '텍스트(tEXt)',
    zTXt: '압축텍스트(zTXt)',
    iTXt: '국제텍스트/XMP(iTXt)',
    eXIf: 'EXIF(eXIf)',
    caBX: 'C2PA(caBX)',
    dSIG: '서명(dSIG)',
  };
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const length = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const chunkEnd = pos + 12 + length; // len(4)+type(4)+data+crc(4)
    if (dropTypes[type]) removed.push(dropTypes[type]);
    else ranges.push([pos, chunkEnd]);
    pos = chunkEnd;
    if (type === 'IEND') break;
  }
  return { output: assemble(bytes, ranges), removed };
}

// ---------- WebP ----------
export function stripWebp(bytes) {
  const fourccAt = (p) =>
    String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
  if (fourccAt(0) !== 'RIFF' || fourccAt(8) !== 'WEBP') throw new Error('WebP 형식이 아님');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const removed = [];
  const dropTypes = { EXIF: 'EXIF', 'XMP ': 'XMP', ICCP: 'ICC 프로파일' };
  const keep = []; // 유지할 청크 [start,end)
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const fourcc = fourccAt(pos);
    const size = dv.getUint32(pos + 4, true); // little-endian
    let chunkEnd = pos + 8 + size + (size % 2); // 짝수 패딩
    if (chunkEnd > bytes.length) chunkEnd = bytes.length;
    if (dropTypes[fourcc]) removed.push(dropTypes[fourcc]);
    else keep.push([pos, chunkEnd, fourcc]);
    pos = chunkEnd;
  }

  // 본문 재조립 (RIFF 헤더 제외)
  let bodyLen = 0;
  for (const [s, e] of keep) bodyLen += e - s;
  const body = new Uint8Array(bodyLen);
  let off = 0;
  for (const [s, e, fourcc] of keep) {
    body.set(bytes.subarray(s, e), off);
    if (fourcc === 'VP8X') {
      // VP8X 플래그에서 EXIF(0x08)/XMP(0x04)/ICC(0x20) 비트 제거
      body[off + 8] &= ~(0x08 | 0x04 | 0x20);
    }
    off += e - s;
  }

  // 'RIFF' + size + 'WEBP' + body
  const out = new Uint8Array(12 + bodyLen);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  new DataView(out.buffer).setUint32(4, 4 + bodyLen, true); // size = 'WEBP' + body
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  out.set(body, 12);
  return { output: out, removed };
}

// ---------- canvas 폴백 (손실) ----------
async function stripViaCanvas(file) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((res) => canvas.toBlob(res, mime, 0.95));
  return { blob, removed: ['모든 메타데이터(재인코딩, 손실 가능)'] };
}

/**
 * @returns {Promise<{blob: Blob, removed: string[], lossless: boolean}>}
 */
export async function stripMetadata(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const type = (file.type || '').toLowerCase();
  try {
    let res;
    if (type.includes('jpeg') || type.includes('jpg')) res = stripJpeg(buf);
    else if (type.includes('png')) res = stripPng(buf);
    else if (type.includes('webp')) res = stripWebp(buf);
    else throw new Error('지원 포맷 아님');
    return {
      blob: new Blob([res.output], { type: file.type }),
      removed: res.removed,
      lossless: true,
    };
  } catch (e) {
    console.warn('포맷별 제거 실패 → canvas 폴백:', e);
    const res = await stripViaCanvas(file);
    return { blob: res.blob, removed: res.removed, lossless: false };
  }
}
