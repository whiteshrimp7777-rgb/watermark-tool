// 브라우저 인비저블 SynthID 교란 (실험적) — 서버/GPU 불필요, 100% 클라이언트.
// reverse-SynthID(aloshdenny)의 "residual bin subtraction" 레시피를 JS로 포팅.
//   residual = 원본 - denoise(원본)
//   각 carrier 주파수 bin에서 residual의 복소값(=워터마크 위상)을 image FFT에서 감산
//   |image_fft[bin]|의 mag_cap 비율로 상한 → 위상을 워터마크 축에서 회전
// carrier bin이 24개뿐이라 전체 FFT 없이 그 주파수만 직접 DFT로 계산(가벼움).
// ⚠️ 효과는 미검증. NLM 디노이즈를 median 3x3로 근사한 점도 원본과 다름. Gemini로 검증 필수.

// 1024x1024 기준 carrier bins (reverse-SynthID/synthid_bypass_v4.py)
const BINS_1024 = [
  [14, 14], [14, -14], [-14, 14], [-14, -14],
  [98, 14], [98, -14], [-98, 14], [-98, -14],
  [126, 14], [126, -14], [-126, 14], [-126, -14],
  [128, 128], [128, -128], [-128, 128], [-128, -128],
  [210, 14], [210, -14], [-210, 14], [-210, -14],
  [238, 14], [238, -14], [-238, 14], [-238, -14],
];
const REF = 1024;

export function scaleBins(H, W) {
  const nyqY = (H / 2) | 0, nyqX = (W / 2) | 0;
  const seen = new Set(), out = [];
  for (const [fy, fx] of BINS_1024) {
    const sy = Math.round((fy * H) / REF);
    const sx = Math.round((fx * W) / REF);
    if (sy === 0 && sx === 0) continue;
    if (Math.abs(sy) >= nyqY || Math.abs(sx) >= nyqX) continue;
    const k = sy + ',' + sx;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([sy, sx]);
  }
  return out;
}

// median 3x3 (NLM 근사 디노이즈)
function median3(src, H, W) {
  const out = new Float64Array(H * W);
  const w = new Array(9);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(H - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(W - 1, Math.max(0, x + dx));
          w[n++] = src[yy * W + xx];
        }
      }
      w.sort((a, b) => a - b);
      out[y * W + x] = w[4];
    }
  }
  return out;
}

// 한 채널에서 carrier bin들의 잔차를 감산
export function processChannel(img, res, H, W, bins, removal, magCap) {
  // bin별 정현파 테이블 (분리형): 행/열 위상 미리 계산
  const out = Float64Array.from(img);
  for (const [sy, sx] of bins) {
    const ay = (-2 * Math.PI * sy) / H; // forward DFT 부호
    const ax = (-2 * Math.PI * sx) / W;
    const cosX = new Float64Array(W), sinX = new Float64Array(W);
    for (let x = 0; x < W; x++) { cosX[x] = Math.cos(ax * x); sinX[x] = Math.sin(ax * x); }
    const cosY = new Float64Array(H), sinY = new Float64Array(H);
    for (let y = 0; y < H; y++) { cosY[y] = Math.cos(ay * y); sinY[y] = Math.sin(ay * y); }

    // res_fft[bin] (복소), img_fft[bin] (크기용)
    let rR = 0, rI = 0, iR = 0, iI = 0;
    for (let y = 0; y < H; y++) {
      let rowRr = 0, rowRi = 0, rowIr = 0, rowIi = 0;
      const off = y * W;
      for (let x = 0; x < W; x++) {
        const cx = cosX[x], sx2 = sinX[x];
        const rv = res[off + x], iv = img[off + x];
        rowRr += rv * cx; rowRi += rv * sx2;
        rowIr += iv * cx; rowIi += iv * sx2;
      }
      const cy = cosY[y], sy2 = sinY[y];
      rR += rowRr * cy - rowRi * sy2; rI += rowRr * sy2 + rowRi * cy;
      iR += rowIr * cy - rowIi * sy2; iI += rowIr * sy2 + rowIi * cy;
    }
    // amount = res_fft * removal, capped at magCap*|img_fft|
    let aR = rR * removal, aI = rI * removal;
    const amp = Math.hypot(aR, aI);
    const cap = magCap * Math.hypot(iR, iI);
    if (amp > cap && cap > 0) { const s = cap / amp; aR *= s; aI *= s; }
    if (amp === 0) continue;

    // 공간역변환: out -= (1/(HW)) * Re(amount * exp(+2πi(sy*y/H+sx*x/W)))
    // exp(+) 이므로 부호 반대 테이블 사용 (cos 동일, sin 부호 반전)
    const norm = 1 / (H * W);
    for (let y = 0; y < H; y++) {
      // exp(+2πi sy y/H): cos(+)=cosY, sin(+)=-sinY
      const eyR = cosY[y], eyI = -sinY[y];
      const off = y * W;
      for (let x = 0; x < W; x++) {
        const exR = cosX[x], exI = -sinX[x];
        // e = exp(+2πi(syY+sxX)) = ey*ex
        const eR = eyR * exR - eyI * exI;
        const eI = eyR * exI + eyI * exR;
        // Re(amount * e)
        const re = aR * eR - aI * eI;
        out[off + x] -= norm * re;
      }
    }
  }
  return out;
}

function psnr(a, b, n) {
  let mse = 0;
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; mse += d * d; }
  mse /= n;
  if (mse === 0) return 100;
  return 10 * Math.log10((255 * 255) / mse);
}

/**
 * @param {File} file
 * @param {{removal?:number, magCap?:number, psnrFloor?:number, onProgress?:Function}} opt
 * @returns {Promise<{blob:Blob, psnr:number, bins:number, rolledBack:boolean}>}
 */
export async function removeSynthIDInBrowser(file, opt = {}) {
  const removal = opt.removal ?? 0.95;
  const magCap = opt.magCap ?? 0.30;
  const psnrFloor = opt.psnrFloor ?? 40.0;
  const progress = opt.onProgress || (() => {});

  progress('이미지 로딩…');
  const bmp = await createImageBitmap(file);
  const H = bmp.height, W = bmp.width;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const imgData = ctx.getImageData(0, 0, W, H);
  const px = imgData.data;
  const N = H * W;

  const bins = scaleBins(H, W);
  if (bins.length === 0) throw new Error('이미지가 너무 작아 carrier 주파수가 없습니다.');

  // 채널 분리
  const chs = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
  for (let i = 0; i < N; i++) {
    chs[0][i] = px[i * 4]; chs[1][i] = px[i * 4 + 1]; chs[2][i] = px[i * 4 + 2];
  }

  const orig = chs.map((c) => Float64Array.from(c));
  const cleaned = [];
  for (let ch = 0; ch < 3; ch++) {
    progress(`처리 중… 채널 ${ch + 1}/3`);
    await new Promise((r) => setTimeout(r)); // UI 양보
    const den = median3(orig[ch], H, W);
    const res = new Float64Array(N);
    for (let i = 0; i < N; i++) res[i] = orig[ch][i] - den[i];
    cleaned[ch] = processChannel(orig[ch], res, H, W, bins, removal, magCap);
  }

  // PSNR 체크 (너무 망가지면 롤백)
  let totMse = 0;
  for (let ch = 0; ch < 3; ch++)
    for (let i = 0; i < N; i++) { const d = orig[ch][i] - cleaned[ch][i]; totMse += d * d; }
  const p = 10 * Math.log10((255 * 255) / (totMse / (N * 3)));
  const rolledBack = p < psnrFloor;
  const finalCh = rolledBack ? orig : cleaned;

  // 픽셀 기록 (canvas 재인코딩으로 메타데이터도 자동 제거됨)
  for (let i = 0; i < N; i++) {
    px[i * 4] = Math.max(0, Math.min(255, Math.round(finalCh[0][i])));
    px[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(finalCh[1][i])));
    px[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(finalCh[2][i])));
    // 알파 유지
  }
  ctx.putImageData(imgData, 0, 0);
  progress('인코딩…');
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return { blob, psnr: p, bins: bins.length, rolledBack };
}
