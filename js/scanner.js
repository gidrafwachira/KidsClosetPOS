/* Camera scanner. Reads the QR code on a tag and calls back with its text. */
(function (root) {
  'use strict';

  var video = null, stream = null, timer = null, detector = null, onCode = null;
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var lastText = '', lastAt = 0, busy = false, torchOn = false;

  function running() { return !!stream; }

  async function start(videoEl, cb) {
    if (running()) stop();
    video = videoEl; onCode = cb;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('This browser cannot open the camera. Type the tag number instead.');
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
    } catch (e) {
      stream = null;
      throw new Error(e && e.name === 'NotAllowedError'
        ? 'Camera permission was refused. Allow the camera for this site in the browser settings, or type the tag number.'
        : 'Could not open the camera. Type the tag number instead.');
    }
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    try { await video.play(); } catch (e) { /* the frame loop below still works once video starts */ }

    detector = null;
    if ('BarcodeDetector' in root) {
      try {
        var formats = await root.BarcodeDetector.getSupportedFormats();
        if (formats.indexOf('qr_code') >= 0) detector = new root.BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) { detector = null; }
    }
    lastText = ''; lastAt = 0; busy = false; torchOn = false;
    timer = setInterval(tick, 140);
  }

  async function tick() {
    if (busy || !stream || !video || video.readyState < 2 || !video.videoWidth) return;
    busy = true;
    try {
      var text = '';
      if (detector) {
        try {
          var found = await detector.detect(video);
          if (found && found.length) text = found[0].rawValue || '';
        } catch (e) { detector = null; }
      }
      if (!detector && !text && root.jsQR) {
        var scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var hit = root.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (hit) text = hit.data || '';
      }
      if (text) {
        var now = Date.now();
        // The same tag held in front of the camera is reported once, not many times a second.
        if (text !== lastText || now - lastAt > 2500) {
          lastText = text; lastAt = now;
          if (onCode) onCode(text);
        } else { lastAt = now; }
      }
    } finally { busy = false; }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (video) video.srcObject = null;
    torchOn = false;
  }

  function hasTorch() {
    try {
      var track = stream && stream.getVideoTracks()[0];
      return !!(track && track.getCapabilities && track.getCapabilities().torch);
    } catch (e) { return false; }
  }
  async function toggleTorch() {
    var track = stream && stream.getVideoTracks()[0];
    if (!track) return false;
    torchOn = !torchOn;
    try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) { torchOn = false; }
    return torchOn;
  }

  /* short sounds so the person scanning does not have to look at the screen */
  var audio = null;
  function beep(kind) {
    try {
      audio = audio || new (root.AudioContext || root.webkitAudioContext)();
      var notes = kind === 'ok' ? [[880, 0, 0.09]] : kind === 'warn' ? [[440, 0, 0.12], [440, 0.18, 0.12]] : [[220, 0, 0.35]];
      notes.forEach(function (n) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = n[0]; o.type = 'square'; g.gain.value = 0.08;
        o.connect(g); g.connect(audio.destination);
        o.start(audio.currentTime + n[1]); o.stop(audio.currentTime + n[1] + n[2]);
      });
    } catch (e) { /* sound is optional */ }
    try { if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 60 : [80, 60, 80]); } catch (e) { /* optional */ }
  }

  root.Scanner = { start: start, stop: stop, running: running, hasTorch: hasTorch, toggleTorch: toggleTorch, beep: beep };
})(window);
