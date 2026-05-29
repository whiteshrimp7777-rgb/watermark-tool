// 진입점: 업로드 → 검사(브라우저) → 전체 제거(GPU 서버).
import { inspectImage } from './inspect.js';
import { setupBackend } from './invisible.backend.js';
import { renderReport, humanSize } from './ui.js';

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

// ---------- SynthID 제거 (GPU 서버) ----------
setupBackend(() => currentFile);
