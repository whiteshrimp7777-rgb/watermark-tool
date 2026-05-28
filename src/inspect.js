// 판별/검사: 이미지에서 메타데이터·출처(C2PA)·AI 태그를 읽어 사람이 읽기 쉬운 리포트로.
// C2PA/AI 흔적은 무거운 라이브러리 대신 "바이트 스캔"으로 직접 탐지 (브라우저에서 100% 안정적).
import exifr from 'exifr';

// Uint8Array에서 ASCII 문자열의 첫 위치 찾기 (없으면 -1)
function findAscii(bytes, str) {
  const pat = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) pat[i] = str.charCodeAt(i);
  const n = bytes.length - pat.length;
  outer: for (let i = 0; i <= n; i++) {
    for (let j = 0; j < pat.length; j++) {
      if (bytes[i + j] !== pat[j]) continue outer;
    }
    return i;
  }
  return -1;
}
const hasAscii = (bytes, str) => findAscii(bytes, str) !== -1;

const AI_SOURCE_TYPES = ['trainedAlgorithmicMedia', 'compositeSynthetic', 'algorithmicMedia'];

/**
 * @returns {Promise<Array<{key, status:'found'|'clean'|'na', value?:string}>>}
 */
export async function inspectImage(file) {
  const rows = [];
  const bytes = new Uint8Array(await file.arrayBuffer());

  // --- EXIF / XMP / IPTC / ICC (exifr) ---
  let parsed = null;
  try {
    parsed = await exifr.parse(file, {
      xmp: true,
      iptc: true,
      icc: true,
      tiff: true,
      ifd0: true,
      exif: true,
    });
  } catch (e) {
    console.warn('exifr 파싱 실패:', e);
  }

  const hasExif = parsed && Object.keys(parsed).length > 0;
  rows.push({
    key: 'EXIF / XMP / IPTC 메타데이터',
    status: hasExif ? 'found' : 'clean',
    value: hasExif ? `${Object.keys(parsed).length}개 항목` : '없음',
  });

  const software = parsed?.Software || parsed?.CreatorTool || parsed?.['xmp:CreatorTool'];
  if (software) rows.push({ key: '제작 소프트웨어', status: 'found', value: String(software) });

  if (parsed?.latitude && parsed?.longitude) {
    rows.push({
      key: 'GPS 위치정보',
      status: 'found',
      value: `${parsed.latitude.toFixed(4)}, ${parsed.longitude.toFixed(4)} (개인정보!)`,
    });
  }

  // --- C2PA / Content Credentials (바이트 스캔) ---
  // C2PA는 JUMBF 박스에 담기며 'jumb'/'c2pa'/'caBX'(PNG) 마커가 존재.
  const c2paMarker =
    hasAscii(bytes, 'jumbc2pa') ||
    hasAscii(bytes, 'caBX') ||
    hasAscii(bytes, 'c2pa.claim') ||
    hasAscii(bytes, 'c2pa.assertions');
  rows.push({
    key: 'C2PA "Content Credentials" (출처 서명)',
    status: c2paMarker ? 'found' : 'clean',
    value: c2paMarker ? '출처 서명 발견 (제거 대상)' : '없음',
  });

  // 생성기/발급자 (C2PA CBOR 안의 텍스트)
  if (hasAscii(bytes, 'Google C2PA')) {
    rows.push({ key: 'C2PA 생성기', status: 'found', value: 'Google C2PA Core Generator Library' });
  } else if (c2paMarker) {
    for (const tool of ['OpenAI', 'DALL', 'Firefly', 'Adobe', 'Microsoft', 'Midjourney']) {
      if (hasAscii(bytes, tool)) {
        rows.push({ key: 'C2PA 생성기 (AI 도구 추정)', status: 'found', value: tool });
        break;
      }
    }
  }

  // --- "Made with AI" / DigitalSourceType ---
  const aiType = AI_SOURCE_TYPES.find((t) => hasAscii(bytes, t));
  const aiText = hasAscii(bytes, 'Generative AI') || hasAscii(bytes, 'Generative Ai');
  if (aiType || aiText) {
    rows.push({
      key: '"AI 생성물" 표시 (DigitalSourceType)',
      status: 'found',
      value: aiType ? aiType : 'Generative AI (C2PA 기록)',
    });
  } else {
    rows.push({ key: '"AI 생성물" 표시', status: 'clean', value: '없음' });
  }

  // --- SynthID ---
  // C2PA에 "SynthID 적용" 기록이 있으면 그 기록 유무는 알 수 있으나,
  // 실제 픽셀 내 SynthID 자체는 브라우저로 판별/제거 불가.
  const synthIdRecord = hasAscii(bytes, 'SynthID');
  if (synthIdRecord) {
    rows.push({
      key: 'SynthID 인비저블 워터마크',
      status: 'found',
      value: 'C2PA에 "SynthID 적용" 기록 있음 (단, 픽셀 속 실제 워터마크는 제거 안 됨 → ③ 참고)',
    });
  } else {
    rows.push({
      key: 'SynthID 인비저블 워터마크',
      status: 'na',
      value: 'C2PA 기록 없음. 픽셀 속 SynthID 여부는 브라우저로 판별 불가 → ③ 외부 도구로 확인',
    });
  }

  return rows;
}
