// 인비저블 제거 — 운영자 GPU 서버(FastAPI + Cloudflare 터널) 연동.
// 업로드한 이미지를 백엔드 /remove 로 보내고 결과를 다운로드.
import { downloadBlob, cleanFilename } from './ui.js';

export function setupBackend(getCurrentFile) {
  const $ = (id) => document.getElementById(id);
  const beUrl = $('beUrl');
  const beToken = $('beToken');
  const beCheck = $('beCheck');
  const beStatus = $('beStatus');
  const beRun = $('beRun');
  const beResult = $('beResult');

  // 입력값 기억 (브라우저 로컬에만 저장)
  beUrl.value = localStorage.getItem('be_url') || '';
  beToken.value = localStorage.getItem('be_token') || '';

  const norm = (u) => u.trim().replace(/\/+$/, '');

  beCheck.addEventListener('click', async () => {
    const url = norm(beUrl.value);
    if (!url) {
      beStatus.textContent = '주소를 입력하세요';
      beStatus.className = 'be-status bad';
      return;
    }
    beStatus.textContent = '확인 중…';
    beStatus.className = 'be-status';
    try {
      const r = await fetch(url + '/health', { method: 'GET' });
      const j = await r.json();
      if (j.ok && j.engine) {
        beStatus.textContent = '연결됨 ✓';
        beStatus.className = 'be-status good';
        beRun.disabled = false;
        localStorage.setItem('be_url', url);
        localStorage.setItem('be_token', beToken.value);
      } else {
        throw new Error('engine not ready');
      }
    } catch (e) {
      beStatus.textContent = '연결 실패 (서버 꺼짐/주소 오류)';
      beStatus.className = 'be-status bad';
      beRun.disabled = true;
    }
  });

  beRun.addEventListener('click', async () => {
    const file = getCurrentFile();
    if (!file) {
      alert('먼저 위에서 이미지를 올려주세요.');
      return;
    }
    const url = norm(beUrl.value);
    const token = beToken.value;
    beRun.disabled = true;
    beRun.textContent = '처리 중… (1~2분, GPU 재생성)';
    beResult.classList.remove('hidden');
    beResult.innerHTML = '<p>서버에서 처리 중입니다. 창을 닫지 마세요…</p>';

    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('token', token);
    fd.append('mode', 'invisible');

    try {
      const r = await fetch(url + '/remove', { method: 'POST', body: fd });
      if (!r.ok) {
        let msg = `오류 ${r.status}`;
        try { msg = (await r.json()).detail || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await r.blob();
      const name = cleanFilename(file.name, '_noinv');
      downloadBlob(blob, name);
      beResult.innerHTML =
        `<p><b>완료:</b> <code>${name}</code> 다운로드됨.</p>` +
        `<p class="muted small">진짜 제거됐는지는 Google SynthID Detector / openai.com/verify 로 전·후 비교하세요. ` +
        `인물 사진이면 얼굴 변화도 확인하세요.</p>`;
    } catch (e) {
      beResult.innerHTML = `<p style="color:#ff5c5c">실패: ${e.message}</p>`;
    } finally {
      beRun.disabled = false;
      beRun.textContent = '이 이미지 인비저블+메타데이터 제거 → 다운로드';
    }
  });
}
