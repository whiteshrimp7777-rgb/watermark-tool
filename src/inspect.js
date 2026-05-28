// 판별/검사: 이미지에서 메타데이터·출처(C2PA)·AI 태그를 읽어 사람이 읽기 쉬운 리포트로.
import exifr from 'exifr';

let _c2paPromise = null;

// c2pa는 WASM/worker가 필요해 초기화가 무거움 → 첫 사용 시 1회 lazy 로드, 실패해도 앱은 계속 동작.
async function getC2pa() {
  if (_c2paPromise) return _c2paPromise;
  _c2paPromise = (async () => {
    try {
      const { createC2pa } = await import('c2pa');
      const wasmSrc = (await import('c2pa/dist/assets/wasm/toolkit_bg.wasm?url')).default;
      const workerSrc = (await import('c2pa/dist/c2pa.worker.min.js?url')).default;
      return await createC2pa({ wasmSrc, workerSrc });
    } catch (e) {
      console.warn('c2pa 초기화 실패 (C2PA 판별은 건너뜀):', e);
      return null;
    }
  })();
  return _c2paPromise;
}

// IPTC DigitalSourceType 중 AI 생성/합성을 가리키는 값들
const AI_SOURCE_TYPES = [
  'trainedAlgorithmicMedia',
  'compositeSynthetic',
  'algorithmicMedia',
];

/**
 * @returns {Promise<Array<{key, status:'found'|'clean'|'na', value?:string}>>}
 */
export async function inspectImage(file) {
  const rows = [];

  // --- EXIF / XMP / IPTC / ICC ---
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
    value: hasExif ? `${Object.keys(parsed).length}개 항목 (카메라/소프트웨어/날짜 등)` : '없음',
  });

  // 제작 소프트웨어 (Software / CreatorTool) — AI 도구명이 자주 박힘
  const software = parsed?.Software || parsed?.CreatorTool || parsed?.['xmp:CreatorTool'];
  if (software) {
    rows.push({ key: '제작 소프트웨어', status: 'found', value: String(software) });
  }

  // "Made with AI" / DigitalSourceType
  const dst =
    parsed?.DigitalSourceType ||
    parsed?.['Iptc4xmpExt:DigitalSourceType'] ||
    parsed?.digitalSourceType;
  if (dst) {
    const v = String(dst);
    const isAI = AI_SOURCE_TYPES.some((t) => v.toLowerCase().includes(t.toLowerCase()));
    rows.push({
      key: '"Made with AI" 태그 (DigitalSourceType)',
      status: isAI ? 'found' : 'na',
      value: v,
    });
  } else {
    rows.push({ key: '"Made with AI" 태그', status: 'clean', value: '없음' });
  }

  // GPS (개인정보)
  if (parsed?.latitude && parsed?.longitude) {
    rows.push({
      key: 'GPS 위치정보',
      status: 'found',
      value: `${parsed.latitude.toFixed(4)}, ${parsed.longitude.toFixed(4)} (개인정보!)`,
    });
  }

  // --- C2PA / Content Credentials ---
  try {
    const c2pa = await getC2pa();
    if (c2pa) {
      const { manifestStore } = await c2pa.read(file);
      if (manifestStore && manifestStore.activeManifest) {
        const m = manifestStore.activeManifest;
        const issuer =
          m.signatureInfo?.issuer || m.claimGenerator || '알 수 없는 발급자';
        rows.push({
          key: 'C2PA "Content Credentials" (출처 서명)',
          status: 'found',
          value: `발급자: ${issuer}`,
        });
        // 생성기에 AI 도구가 들어있는지
        if (m.claimGenerator && /openai|dall|firefly|adobe|gemini|midjourney|stable/i.test(m.claimGenerator)) {
          rows.push({
            key: 'C2PA 생성기 (AI 도구 추정)',
            status: 'found',
            value: m.claimGenerator,
          });
        }
      } else {
        rows.push({ key: 'C2PA "Content Credentials"', status: 'clean', value: '없음' });
      }
    } else {
      rows.push({
        key: 'C2PA "Content Credentials"',
        status: 'na',
        value: '판별 모듈 미로딩 (건너뜀)',
      });
    }
  } catch (e) {
    rows.push({ key: 'C2PA "Content Credentials"', status: 'clean', value: '없음' });
  }

  // --- SynthID (브라우저 판별 불가, 안내) ---
  rows.push({
    key: 'SynthID 인비저블 워터마크',
    status: 'na',
    value: '브라우저에서 판별 불가 → 아래 ③ 외부 도구로 확인',
  });

  return rows;
}
