// 메타데이터 제거 walker 검증 (Node 실행: node test/strip.test.mjs)
import { stripJpeg, stripPng, stripWebp } from '../src/strip.js';
import zlib from 'node:zlib';

let pass = 0,
  fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
    console.log('  ✓ ' + msg);
  } else {
    fail++;
    console.error('  ✗ ' + msg);
  }
};
const has = (bytes, ...marker) => {
  for (let i = 0; i <= bytes.length - marker.length; i++) {
    if (marker.every((m, j) => bytes[i + j] === m)) return true;
  }
  return false;
};

// CRC32 (PNG)
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (~c) >>> 0;
}

// ---------- JPEG ----------
console.log('JPEG:');
{
  const parts = [];
  parts.push(0xff, 0xd8); // SOI
  // APP1 (EXIF) length=10 → 8 data bytes
  parts.push(0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x11, 0x22);
  // APP0 (JFIF) length=8 → keep
  parts.push(0xff, 0xe0, 0x00, 0x08, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01);
  // DQT (FFDB) length=4, keep
  parts.push(0xff, 0xdb, 0x00, 0x04, 0xaa, 0xbb);
  // SOS (FFDA) length=4 then scan data + EOI
  parts.push(0xff, 0xda, 0x00, 0x04, 0x01, 0x00, 0xde, 0xad, 0xbe, 0xef, 0xff, 0xd9);
  const input = Uint8Array.from(parts);
  const { output, removed } = stripJpeg(input);
  ok(output[0] === 0xff && output[1] === 0xd8, 'SOI 보존');
  ok(!has(output, 0xff, 0xe1), 'APP1(EXIF) 제거됨');
  ok(has(output, 0xff, 0xe0), 'APP0(JFIF) 보존');
  ok(has(output, 0xff, 0xdb), 'DQT 보존');
  ok(has(output, 0xde, 0xad, 0xbe, 0xef), '스캔 데이터 보존');
  ok(has(output, 0xff, 0xd9), 'EOI 보존');
  ok(removed.some((r) => r.includes('APP1')), `removed 목록에 APP1 (${removed.join(', ')})`);
}

// ---------- PNG ----------
console.log('PNG:');
{
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii');
    const body = Buffer.concat([t, Buffer.from(data)]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const text = chunk('tEXt', Buffer.from('Comment\x00made by AI'));
  const idat = chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0])));
  const iend = chunk('IEND', Buffer.from([]));
  const input = new Uint8Array(Buffer.concat([sig, ihdr, text, idat, iend]));
  const { output, removed } = stripPng(input);
  const o = Buffer.from(output);
  ok(o.subarray(0, 8).equals(sig), 'PNG 시그니처 보존');
  ok(o.includes(Buffer.from('IHDR')), 'IHDR 보존');
  ok(o.includes(Buffer.from('IDAT')), 'IDAT(픽셀) 보존');
  ok(o.includes(Buffer.from('IEND')), 'IEND 보존');
  ok(!o.includes(Buffer.from('tEXt')), 'tEXt(메타데이터) 제거됨');
  ok(!o.includes(Buffer.from('made by AI')), '텍스트 내용 제거됨');
  ok(removed.length === 1, `removed 1건 (${removed.join(', ')})`);
}

// ---------- WebP ----------
console.log('WebP:');
{
  const le32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const webpChunk = (fourcc, data) => {
    const buf = Buffer.concat([Buffer.from(fourcc, 'ascii'), le32(data.length), Buffer.from(data)]);
    return data.length % 2 ? Buffer.concat([buf, Buffer.from([0])]) : buf;
  };
  const vp8x = webpChunk('VP8X', [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // flags=0x2c (ICC+EXIF+XMP set)
  const vp8 = webpChunk('VP8 ', [1, 2, 3, 4]);
  const exif = webpChunk('EXIF', Buffer.from('exifdata'));
  const xmp = webpChunk('XMP ', Buffer.from('<xmp/>'));
  const body = Buffer.concat([vp8x, vp8, exif, xmp]);
  const riff = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    le32(4 + body.length),
    Buffer.from('WEBP', 'ascii'),
    body,
  ]);
  const input = new Uint8Array(riff);
  const { output, removed } = stripWebp(input);
  const o = Buffer.from(output);
  ok(o.subarray(0, 4).toString('ascii') === 'RIFF', 'RIFF 헤더 보존');
  ok(o.subarray(8, 12).toString('ascii') === 'WEBP', 'WEBP 보존');
  ok(o.includes(Buffer.from('VP8 ')), '이미지 데이터(VP8) 보존');
  ok(!o.includes(Buffer.from('EXIF')), 'EXIF 청크 제거됨');
  ok(!o.includes(Buffer.from('XMP ')), 'XMP 청크 제거됨');
  // RIFF size 정합성
  const declaredSize = o.readUInt32LE(4);
  ok(declaredSize === o.length - 8, `RIFF size 정합 (${declaredSize} == ${o.length - 8})`);
  // VP8X 플래그 클리어 확인: VP8X 데이터 첫 바이트
  const vpos = o.indexOf(Buffer.from('VP8X'));
  ok((o[vpos + 8] & (0x08 | 0x04 | 0x20)) === 0, 'VP8X EXIF/XMP/ICC 플래그 클리어됨');
  ok(removed.length === 2, `removed 2건 (${removed.join(', ')})`);
}

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
