// UI 헬퍼: 검사 리포트 렌더링, 다운로드, 파일 메타 표시.

const BADGE = {
  found: { cls: 'found', label: '발견' },
  clean: { cls: 'clean', label: '없음' },
  na: { cls: 'na', label: '확인불가' },
};

export function renderReport(el, rows) {
  el.innerHTML = '';
  for (const r of rows) {
    const b = BADGE[r.status] || BADGE.na;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <span class="badge ${b.cls}">${b.label}</span>
      <div>
        <div class="k">${escapeHtml(r.key)}</div>
        ${r.value ? `<div class="v">${escapeHtml(r.value)}</div>` : ''}
      </div>`;
    el.appendChild(row);
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function cleanFilename(original, suffix = '_clean') {
  const dot = original.lastIndexOf('.');
  if (dot < 0) return original + suffix;
  return original.slice(0, dot) + suffix + original.slice(dot);
}

export function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
