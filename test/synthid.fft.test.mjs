// FFT carrier-subtraction 수학 검증 (Node)
import { scaleBins, processChannel } from '../src/synthid.fft.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// 브루트포스 DFT 한 bin
function dftBin(g, H, W, sy, sx) {
  let R = 0, I = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = -2 * Math.PI * (sy * y / H + sx * x / W);
      R += g[y * W + x] * Math.cos(a);
      I += g[y * W + x] * Math.sin(a);
    }
  return [R, I];
}

const H = 64, W = 96, N = H * W;

// 1) scaleBins: DC/Nyquist 제외, 비례 스케일
console.log('scaleBins:');
{
  const bins = scaleBins(H, W);
  ok(bins.length > 0, `bins 생성됨 (${bins.length}개)`);
  ok(bins.every(([y, x]) => Math.abs(y) < H / 2 && Math.abs(x) < W / 2), '모두 Nyquist 이내');
  ok(bins.every(([y, x]) => !(y === 0 && x === 0)), 'DC 없음');
  // 켤레쌍 존재 (실수 출력 보장의 핵심)
  const set = new Set(bins.map((b) => b.join(',')));
  const hasConj = bins.every(([y, x]) => set.has((-y) + ',' + (-x)));
  ok(hasConj, '모든 bin의 켤레쌍 존재 (실수 출력 보장)');
}

// 2) 합성 이미지: 한 carrier bin에 사인파 주입 → 제거 후 그 bin 에너지 급감 + 실수성 + 고PSNR
console.log('carrier 제거:');
{
  const bins = scaleBins(H, W);
  const [ty, tx] = bins[0]; // 타깃 bin
  // 베이스(완만한 그라데이션) + 타깃 bin 사인파(워터마크 모사)
  const orig = new Float64Array(N);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const base = 128 + 20 * Math.cos((2 * Math.PI * 2 * x) / W);
      const wm = 6 * Math.cos((2 * Math.PI * (ty * y / H + tx * x / W)));
      orig[y * W + x] = base + wm;
    }
  // residual = 워터마크 성분만 (이상적 디노이즈 가정)
  const res = new Float64Array(N);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      res[y * W + x] = 6 * Math.cos((2 * Math.PI * (ty * y / H + tx * x / W)));

  const before = Math.hypot(...dftBin(orig, H, W, ty, tx));
  const out = processChannel(orig, res, H, W, bins, 0.95, 0.30);
  const after = Math.hypot(...dftBin(out, H, W, ty, tx));

  ok(after < before, `타깃 bin 에너지 감소 (${before.toFixed(0)} → ${after.toFixed(0)})`);

  // 실수성: 출력이 NaN/복소 누수 없이 유한
  ok(out.every((v) => Number.isFinite(v)), '출력 전부 유한(실수 누수 없음)');

  // 고PSNR: 이미지가 거의 안 변함
  let mse = 0;
  for (let i = 0; i < N; i++) { const d = orig[i] - out[i]; mse += d * d; }
  mse /= N;
  const p = 10 * Math.log10((255 * 255) / mse);
  ok(p > 34, `PSNR 양호 (${p.toFixed(1)} dB)`);

  // mag_cap 준수: 변화량이 cap 근처 이하
  const cap = 0.30 * before;
  ok(before - after <= cap * 1.2 + 1, `감산량이 mag_cap 범위 (Δ=${(before - after).toFixed(0)}, cap=${cap.toFixed(0)})`);
}

// 3) 비타깃 주파수는 거의 안 건드림
console.log('비타깃 보존:');
{
  const bins = scaleBins(H, W);
  const orig = new Float64Array(N);
  for (let i = 0; i < N; i++) orig[i] = 128 + 30 * Math.cos((2 * Math.PI * 3 * (i % W)) / W);
  const res = new Float64Array(N); // 잔차 0 → 아무것도 안 빼야 함
  const out = processChannel(orig, res, H, W, bins, 0.95, 0.30);
  let maxd = 0;
  for (let i = 0; i < N; i++) maxd = Math.max(maxd, Math.abs(orig[i] - out[i]));
  ok(maxd < 1e-6, `잔차 0이면 변화 없음 (max Δ=${maxd.toExponential(1)})`);
}

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
