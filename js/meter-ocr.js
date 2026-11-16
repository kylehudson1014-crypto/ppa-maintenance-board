/* On-device meter OCR for the CFI post-flight form.
   Uses Tesseract.js from a CDN (loaded on first Snap). Digits only. No paid APIs.
   Photos stay in memory and are sent only with the billing-sheet POST — never stored in Firestore. */
var PPAMeterOcr = (function () {
  var TESS_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var MAX_EDGE = 1280;
  var JPEG_QUALITY = 0.72;
  var workerPromise = null;
  var tessLoading = null;

  function loadScript() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tessLoading) return tessLoading;
    tessLoading = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = TESS_SRC;
      s.onload = function () { res(window.Tesseract); };
      s.onerror = function () { tessLoading = null; rej(new Error('Could not load the on-device reader (Tesseract). Check your connection and try again.')); };
      document.head.appendChild(s);
    });
    return tessLoading;
  }

  function getWorker() {
    if (workerPromise) return workerPromise;
    workerPromise = loadScript().then(function (T) {
      return T.createWorker('eng', 1);
    }).then(function (w) {
      return w.setParameters({
        tessedit_char_whitelist: '0123456789.',
        tessedit_pageseg_mode: '7'
      }).then(function () { return w; });
    }).catch(function (e) { workerPromise = null; throw e; });
    return workerPromise;
  }

  function downscaleBlob(file, maxEdge, quality) {
    maxEdge = maxEdge || MAX_EDGE;
    quality = quality == null ? JPEG_QUALITY : quality;
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          var scale = Math.min(1, maxEdge / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var c = document.createElement('canvas');
          c.width = cw; c.height = ch;
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          var dataUrl = c.toDataURL('image/jpeg', quality);
          URL.revokeObjectURL(url);
          res({ canvas: c, dataUrl: dataUrl, width: cw, height: ch });
        } catch (e) { URL.revokeObjectURL(url); rej(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Could not read that photo.')); };
      img.src = url;
    });
  }

  // Default crop is a centered band — typical framing for a Hobbs / Tach face.
  function defaultCrop(w, h) {
    var cw = Math.round(w * 0.78), ch = Math.round(h * 0.32);
    return { x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), w: cw, h: ch };
  }

  function preprocess(srcCanvas, crop, opt) {
    opt = opt || {};
    crop = crop || defaultCrop(srcCanvas.width, srcCanvas.height);
    var x = Math.max(0, Math.round(crop.x)), y = Math.max(0, Math.round(crop.y));
    var w = Math.max(8, Math.round(crop.w)), h = Math.max(8, Math.round(crop.h));
    if (x + w > srcCanvas.width) w = srcCanvas.width - x;
    if (y + h > srcCanvas.height) h = srcCanvas.height - y;
    var scale = opt.scale || 3;
    var out = document.createElement('canvas');
    out.width = Math.max(1, w * scale);
    out.height = Math.max(1, h * scale);
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(srcCanvas, x, y, w, h, 0, 0, out.width, out.height);
    var img = ctx.getImageData(0, 0, out.width, out.height);
    var d = img.data;
    var contrast = opt.contrast == null ? 1.6 : opt.contrast;
    var bright = opt.bright == null ? 12 : opt.bright;
    var invert = !!opt.invert;
    for (var i = 0; i < d.length; i += 4) {
      var g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      g = (g - 128) * contrast + 128 + bright;
      if (g < 0) g = 0; if (g > 255) g = 255;
      if (invert) g = 255 - g;
      // Soft threshold to ink-on-paper for Tesseract.
      var t = g > 150 ? 255 : (g < 90 ? 0 : g);
      d[i] = d[i + 1] = d[i + 2] = t;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }

  function parseDigits(text) {
    if (!text) return null;
    var cleaned = String(text).replace(/[^\d.]/g, '');
    // Keep one decimal point — meters are typically 1 decimal place (e.g. 4413.2).
    var parts = cleaned.split('.');
    if (parts.length > 2) cleaned = parts[0] + '.' + parts.slice(1).join('');
    if (!cleaned || cleaned === '.') return null;
    var n = Number(cleaned);
    if (isNaN(n) || n < 0 || n > 100000) return null;
    // Hobbs/Tach usually show tenths. If we got a long integer with no decimal, insert one before the last digit when it looks like a 1-decimal meter.
    if (cleaned.indexOf('.') < 0 && cleaned.length >= 4 && cleaned.length <= 6) {
      var withTenth = Number(cleaned.slice(0, -1) + '.' + cleaned.slice(-1));
      if (!isNaN(withTenth)) {
        return { value: Math.round(withTenth * 10) / 10, raw: String(text).trim(), cleaned: cleaned, assumedTenth: true };
      }
    }
    var rounded = cleaned.indexOf('.') >= 0 ? Math.round(n * 10) / 10 : n;
    return { value: rounded, raw: String(text).trim(), cleaned: cleaned, assumedTenth: false };
  }

  function dataUrlToRawBase64(dataUrl) {
    if (!dataUrl) return '';
    var i = String(dataUrl).indexOf('base64,');
    return i >= 0 ? String(dataUrl).slice(i + 7) : String(dataUrl);
  }

  function recognize(srcCanvas, crop, opt) {
    return getWorker().then(function (w) {
      var pre = preprocess(srcCanvas, crop, opt);
      return w.recognize(pre).then(function (r) {
        var text = r && r.data && r.data.text ? r.data.text : '';
        var conf = r && r.data && typeof r.data.confidence === 'number' ? r.data.confidence : null;
        var parsed = parseDigits(text);
        return { text: text, confidence: conf, parsed: parsed, preprocessed: pre };
      });
    });
  }

  // Try normal and inverted preprocess; keep the parse that looks more like a meter reading.
  function recognizeBest(srcCanvas, crop) {
    return recognize(srcCanvas, crop, { invert: false }).then(function (a) {
      return recognize(srcCanvas, crop, { invert: true }).then(function (b) {
        function score(x) {
          if (!x.parsed) return -1;
          var s = (x.confidence || 0);
          if (String(x.parsed.value).indexOf('.') >= 0 || x.parsed.assumedTenth) s += 8;
          return s;
        }
        return score(b) > score(a) ? b : a;
      });
    });
  }

  return {
    MAX_EDGE: MAX_EDGE,
    downscaleBlob: downscaleBlob,
    defaultCrop: defaultCrop,
    preprocess: preprocess,
    parseDigits: parseDigits,
    dataUrlToRawBase64: dataUrlToRawBase64,
    recognize: recognize,
    recognizeBest: recognizeBest,
    loadScript: loadScript
  };
})();
if (typeof module !== 'undefined') module.exports = PPAMeterOcr;
