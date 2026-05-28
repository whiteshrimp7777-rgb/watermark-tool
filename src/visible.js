// 보이는 워터마크 대응: canvas 위에서 드래그로 영역을 선택해 잘라내기(크롭).
// 가장자리/모서리 워터마크는 잘라내는 게 가장 확실. 본격 인페인팅은 v1 미포함.

export function setupCrop(canvas, sourceFile, onCropped) {
  const ctx = canvas.getContext('2d');
  let img = null;
  let scale = 1;
  let sel = null; // {x,y,w,h} (캔버스 좌표)
  let dragging = false;
  let start = null;

  const MAX_W = 760; // 화면 표시용 최대 폭

  async function load() {
    const bmp = await createImageBitmap(sourceFile);
    img = bmp;
    scale = Math.min(1, MAX_W / bmp.width);
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    redraw();
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (sel) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      // 선택 영역 바깥 어둡게
      ctx.fillRect(0, 0, canvas.width, sel.y);
      ctx.fillRect(0, sel.y + sel.h, canvas.width, canvas.height - sel.y - sel.h);
      ctx.fillRect(0, sel.y, sel.x, sel.h);
      ctx.fillRect(sel.x + sel.w, sel.y, canvas.width - sel.x - sel.w, sel.h);
      ctx.strokeStyle = '#4f8cff';
      ctx.lineWidth = 2;
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.restore();
    }
  }

  function pointer(e) {
    const r = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    // 표시 크기와 실제 캔버스 픽셀 비율 보정
    return {
      x: (cx / r.width) * canvas.width,
      y: (cy / r.height) * canvas.height,
    };
  }

  function down(e) {
    e.preventDefault();
    dragging = true;
    start = pointer(e);
    sel = { x: start.x, y: start.y, w: 0, h: 0 };
  }
  function move(e) {
    if (!dragging) return;
    const p = pointer(e);
    sel = {
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    };
    redraw();
  }
  function up() {
    dragging = false;
  }

  canvas.addEventListener('mousedown', down);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  canvas.addEventListener('touchstart', down, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', up);

  async function apply() {
    if (!sel || sel.w < 4 || sel.h < 4) {
      alert('남길 영역을 드래그로 선택하세요.');
      return;
    }
    // 캔버스 좌표 → 원본 픽셀 좌표
    const sx = Math.round(sel.x / scale);
    const sy = Math.round(sel.y / scale);
    const sw = Math.round(sel.w / scale);
    const sh = Math.round(sel.h / scale);
    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    out.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const mime = sourceFile.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((res) => out.toBlob(res, mime, 0.95));
    onCropped(blob, mime);
  }

  function reset() {
    sel = null;
    redraw();
  }

  load();
  return { apply, reset };
}
