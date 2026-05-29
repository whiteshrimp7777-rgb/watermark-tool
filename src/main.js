// 진입점: 업로드 → 검사(브라우저) → 전체 제거(GPU 서버).
import { inspectImage } from './inspect.js';
import { setupBackend } from './invisible.backend.js';
import { removeSynthIDInBrowser } from './synthid.fft.js';
import { renderReport, humanSize, downloadBlob, cleanFilename } from './ui.js';

const $ = (id) => document.getElementById(id);

const dropzone = $('dropzone');
const fileInput = $('fileInput');
const resultSec = $('result');
const preview = $('preview');
const fileMeta = $('fileMeta');
const inspectReport = $('inspectReport');

let currentFile = null;

// ---------- 업로드 ----------
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});
['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
  })
);
dropzone.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});

async function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('이미지 파일을 올려주세요.');
    return;
  }
  currentFile = file;
  resultSec.classList.remove('hidden');

  // 미리보기
  preview.src = URL.createObjectURL(file);
  fileMeta.textContent = `${file.name} · ${humanSize(file.size)} · ${file.type || '알 수 없음'}`;

  // 검사 (브라우저, 서버 불필요)
  inspectReport.textContent = '검사 중…';
  try {
    const rows = await inspectImage(file);
    renderReport(inspectReport, rows);
  } catch (e) {
    inspectReport.textContent = '검사 중 오류: ' + e.message;
  }
}

// ---------- 방법 B: GPU 서버 ----------
setupBackend(() => currentFile);

// ---------- 방법 A: 브라우저 FFT (서버리스, 실험적) ----------
const fftRun = $('fftRun');
const fftResult = $('fftResult');
fftRun.addEventListener('click', async () => {
  if (!currentFile) {
    alert('먼저 위에서 이미지를 올려주세요.');
    return;
  }
  fftRun.disabled = true;
  const orig = fftRun.textContent;
  fftResult.classList.remove('hidden');
  fftResult.innerHTML = '<p>처리 중…</p>';
  try {
    const { blob, psnr, bins, rolledBack } = await removeSynthIDInBrowser(currentFile, {
      onProgress: (m) => {
        fftRun.textContent = m;
        fftResult.innerHTML = `<p>${m}</p>`;
      },
    });
    const name = cleanFilename(currentFile.name, '_nosynthid');
    downloadBlob(blob, name);
    fftResult.innerHTML = rolledBack
      ? `<p style="color:#ffb02e">⚠️ 변화가 너무 커서 안전상 원본을 유지했습니다(메타데이터만 제거됨). ` +
        `이 이미지엔 이 방식이 잘 안 맞을 수 있어요. (PSNR ${psnr.toFixed(1)})</p>`
      : `<p><b>완료:</b> <code>${name}</code> 다운로드됨 ` +
        `(주파수 ${bins}곳 교란, PSNR ${psnr.toFixed(1)}dB, 메타데이터 제거 포함)</p>` +
        `<p class="muted small">⚠️ 실제로 SynthID가 사라졌는지는 ③ Gemini로 전/후 비교하세요. ` +
        `"감지 안 됨"이 완전 제거를 보장하진 않습니다.</p>`;
  } catch (e) {
    fftResult.innerHTML = `<p style="color:#ff5c5c">실패: ${e.message}</p>`;
  } finally {
    fftRun.disabled = false;
    fftRun.textContent = orig;
  }
});
