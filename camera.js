/* Камера: живое чтение штрихкода IMEI. Сначала встроенный BarcodeDetector (Chrome, Android), иначе библиотека ZXing,
   которая один раз скачивается и дальше хранится в кэше. Запасные варианты: фото из файла и распознавание цифр (OCR). */
(function () {
'use strict';
const ZX_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const OCR_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const FORMATS = ['code_128', 'code_39', 'code_93', 'ean_13', 'itf'];

let stream = null, track = null, video = null, raf = 0, running = false, onFound = null;
let detector = null, zxReader = null, last = 0;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = () => window[globalName] ? res(window[globalName]) : rej(new Error('no global'));
    s.onerror = () => rej(new Error('load failed'));
    document.head.appendChild(s);
  });
}

async function makeDetector() {
  if (detector || zxReader) return;
  if ('BarcodeDetector' in window) {
    try {
      const sup = await BarcodeDetector.getSupportedFormats();
      const want = FORMATS.filter(f => sup.includes(f));
      if (want.length) { detector = new BarcodeDetector({ formats: want }); return; }
    } catch (e) {}
  }
  const ZX = await loadScript(ZX_URL, 'ZXing');
  const hints = new Map();
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.CODE_93, ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.ITF]);
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  zxReader = new ZX.MultiFormatReader();
  zxReader.setHints(hints);
}
function zxDecodeCanvas() {
  const ZX = window.ZXing;
  try {
    const src = new ZX.HTMLCanvasElementLuminanceSource(canvas);
    return zxReader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(src))).getText();
  } catch (e) { return null; }
}
function drawToCanvas(source, w, h) {
  const maxW = 1100;
  canvas.width = Math.min(w, maxW);
  canvas.height = Math.round(canvas.width * h / w);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
}
async function decodeSource(source, w, h) {
  if (detector) {
    const codes = await detector.detect(source);
    return codes.map(c => c.rawValue).join(' ');
  }
  drawToCanvas(source, w, h);
  return zxDecodeCanvas();
}

async function tick() {
  if (!running) return;
  const now = performance.now();
  if (video.readyState >= 2 && video.videoWidth && now - last > 120) {
    last = now;
    let text = null;
    try { text = await decodeSource(video, video.videoWidth, video.videoHeight); } catch (e) {}
    if (running && text) {
      const r = Core.extractImeis(text);
      if (r.valid.length) { const cb = onFound; stop(); if (navigator.vibrate) navigator.vibrate(60); cb(r.valid); return; }
    }
  }
  if (running) raf = requestAnimationFrame(tick);
}

async function start(videoEl, cb) {
  stop();
  video = videoEl; onFound = cb;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw { code: 'nocam' };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (e) {
    throw { code: e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : (e && e.name === 'NotFoundError' ? 'nocam' : 'camerr') };
  }
  track = stream.getVideoTracks()[0];
  video.srcObject = stream;
  video.setAttribute('playsinline', ''); video.muted = true;
  try { await video.play(); } catch (e) {}
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch (e) {}
  try { await makeDetector(); } catch (e) { stop(); throw { code: 'nodecoder' }; }
  running = true;
  raf = requestAnimationFrame(tick);
}
function stop() {
  running = false;
  cancelAnimationFrame(raf);
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (video) video.srcObject = null;
  stream = null; track = null;
}
const hasTorch = () => { try { const c = track && track.getCapabilities && track.getCapabilities(); return !!(c && c.torch); } catch (e) { return false; } };
async function setTorch(on) {
  try { await track.applyConstraints({ advanced: [{ torch: !!on }] }); return true; } catch (e) { return false; }
}

/* фото из файла: штрихкод */
async function decodeFile(file) {
  await makeDetector();
  const bmp = await createImageBitmap(file);
  const text = await decodeSource(bmp, bmp.width, bmp.height);
  return Core.extractImeis(text || '');
}

/* кадр из видео -> цифры (OCR). Первый запуск скачивает модель, дальше работает из кэша. */
async function ocrFrame(videoEl, onProgress) {
  const T = await loadScript(OCR_URL, 'Tesseract');
  const w = videoEl.videoWidth, h = videoEl.videoHeight;
  if (!w) throw { code: 'noframe' };
  drawToCanvas(videoEl, w, h);
  const worker = await T.createWorker('eng', 1, { logger: m => { if (onProgress && m.status) onProgress(m.status, m.progress); } });
  try {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789 ', tessedit_pageseg_mode: '6' });
    const res = await worker.recognize(canvas);
    return Core.extractImeis(res.data.text || '');
  } finally { await worker.terminate(); }
}
function snapshotPaused(videoEl) { running = false; cancelAnimationFrame(raf); videoEl.pause(); }

window.Cam = { start, stop, hasTorch, setTorch, decodeFile, ocrFrame, snapshotPaused,
  isRunning: () => running };
})();
