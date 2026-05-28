// 진입점: 업로드 → 검사 → 제거/크롭 → 다운로드 배선.
import { inspectImage } from './inspect.js';
import { stripMetadata } from './strip.js';
import { setupCrop } from './visible.js';
import { renderReport, downloadBlob, cleanFilename, humanSize } from './ui.js';

const $ = (id) => document.getElementById(id);

const dropzone = $('dropzone');
const fileInput = $('fileInput');
const resultSec = $('result');
const preview = $('preview');
const fileMeta = $('fileMeta');
const inspectReport = $('inspectReport');
const stripBtn = $('stripBtn');
const stripResult = $('stripResult');
const cropBtn = $('cropBtn');
const cropPanel = $('cropPanel');
const cropCanvas = $('cropCanvas');
const cropApply = $('cropApply');
const cropReset = $('cropReset');

let currentFile = null;
let cropper = null;

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
  cropPanel.classList.add('hidden');
  stripResult.classList.add('hidden');

  // 미리보기
  preview.src = URL.createObjectURL(file);
  fileMeta.textContent = `${file.name} · ${humanSize(file.size)} · ${file.type || '알 수 없음'}`;

  // 검사
  inspectReport.textContent = '검사 중…';
  try {
    const rows = await inspectImage(file);
    renderReport(inspectReport, rows);
  } catch (e) {
    inspectReport.textContent = '검사 중 오류: ' + e.message;
  }
}

// ---------- 메타데이터 제거 ----------
stripBtn.addEventListener('click', async () => {
  if (!currentFile) return;
  stripBtn.disabled = true;
  stripBtn.textContent = '처리 중…';
  try {
    const { blob, removed, lossless } = await stripMetadata(currentFile);
    const name = cleanFilename(currentFile.name);
    downloadBlob(blob, name);

    stripResult.classList.remove('hidden');
    const list = removed.length
      ? removed.map((r) => `<li>${r}</li>`).join('')
      : '<li>제거할 메타데이터가 없었습니다 (이미 깨끗함)</li>';
    stripResult.innerHTML = `
      <p><b>완료:</b> <code>${name}</code> 다운로드됨
      ${lossless ? '(픽셀 무손실)' : '<b>(재인코딩 — 화질 약간 손실 가능)</b>'}</p>
      <p>제거된 항목:</p>
      <ul>${list}</ul>
      <p class="muted small">확인: 다운로드한 파일을 이 도구에 다시 올려보거나,
      contentcredentials.org/verify 에서 전/후를 비교하세요.</p>`;
  } catch (e) {
    stripResult.classList.remove('hidden');
    stripResult.textContent = '제거 중 오류: ' + e.message;
  } finally {
    stripBtn.disabled = false;
    stripBtn.textContent = '메타데이터 제거 → 다운로드';
  }
});

// ---------- 크롭 도구 ----------
cropBtn.addEventListener('click', () => {
  if (!currentFile) return;
  cropPanel.classList.toggle('hidden');
  if (!cropPanel.classList.contains('hidden')) {
    cropper = setupCrop(cropCanvas, currentFile, (blob) => {
      downloadBlob(blob, cleanFilename(currentFile.name, '_crop'));
    });
  }
});
cropApply.addEventListener('click', () => cropper && cropper.apply());
cropReset.addEventListener('click', () => cropper && cropper.reset());
