const CC_PER_STOP = Math.log10(2) * 100;
const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 };

const state = {
  stream: null,
  running: false,
  frozen: false,
  mode: "manual",
  heldSample: null,
  lastSample: null,
  filters: { c: 0, m: 0, y: 0 },
};

const el = {
  startCamera: document.querySelector("#startCamera"),
  freezeFrame: document.querySelector("#freezeFrame"),
  autoBalance: document.querySelector("#autoBalance"),
  manualMode: document.querySelector("#manualMode"),
  autoMode: document.querySelector("#autoMode"),
  resetFilters: document.querySelector("#resetFilters"),
  lockSample: document.querySelector("#lockSample"),
  normalizePack: document.querySelector("#normalizePack"),
  cameraMessage: document.querySelector("#cameraMessage"),
  video: document.querySelector("#camera"),
  rawCanvas: document.querySelector("#rawCanvas"),
  viewCanvas: document.querySelector("#viewCanvas"),
  rawSwatch: document.querySelector("#rawSwatch"),
  filteredSwatch: document.querySelector("#filteredSwatch"),
  rawReadout: document.querySelector("#rawReadout"),
  filteredReadout: document.querySelector("#filteredReadout"),
  deltaPack: document.querySelector("#deltaPack"),
  recommendedPack: document.querySelector("#recommendedPack"),
  viewingStops: document.querySelector("#viewingStops"),
  packStops: document.querySelector("#packStops"),
  currentC: document.querySelector("#currentC"),
  currentM: document.querySelector("#currentM"),
  currentY: document.querySelector("#currentY"),
  sliders: {
    c: document.querySelector("#cyan"),
    m: document.querySelector("#magenta"),
    y: document.querySelector("#yellow"),
  },
  numbers: {
    c: document.querySelector("#cyanNumber"),
    m: document.querySelector("#magentaNumber"),
    y: document.querySelector("#yellowNumber"),
  },
};

const rawCtx = el.rawCanvas.getContext("2d", { willReadFrequently: true });
const viewCtx = el.viewCanvas.getContext("2d", { willReadFrequently: true });

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function roundPack(value) {
  return Math.round(value * 10) / 10;
}

function readNumber(input) {
  return clamp(Number.parseFloat(input.value), 0, 300);
}

function transmission(cc) {
  return 10 ** (-cc / 100);
}

function stopsFromTransmission(t) {
  return -Math.log2(Math.max(t, 0.000001));
}

function formatStops(stops) {
  const sign = stops > 0.005 ? "+" : "";
  return `${sign}${stops.toFixed(2)} stops`;
}

function formatPack(pack) {
  return `C ${roundPack(pack.c)} / M ${roundPack(pack.m)} / Y ${roundPack(pack.y)}`;
}

function rgbCss(rgb) {
  if (!rgb) return "#202420";
  return `rgb(${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)})`;
}

function rgbReadout(rgb) {
  if (!rgb) return "--";
  return `R ${Math.round(rgb.r)} / G ${Math.round(rgb.g)} / B ${Math.round(rgb.b)}`;
}

function filteredRgb(rgb, filters = state.filters) {
  if (!rgb) return null;
  return {
    r: rgb.r * transmission(filters.c),
    g: rgb.g * transmission(filters.m),
    b: rgb.b * transmission(filters.y),
  };
}

function setFilters(nextFilters) {
  for (const key of ["c", "m", "y"]) {
    const value = clamp(Number.parseFloat(nextFilters[key]), 0, 300);
    state.filters[key] = value;
    el.sliders[key].value = Math.min(value, Number(el.sliders[key].max));
    el.numbers[key].value = roundPack(value);
  }
  updateCalculations();
}

function hasSample() {
  return Boolean(state.heldSample || state.lastSample);
}

function updateModeControls() {
  const isAuto = state.mode === "auto";
  el.manualMode.checked = !isAuto;
  el.autoMode.checked = isAuto;
  el.autoBalance.disabled = !hasSample();

  for (const key of ["c", "m", "y"]) {
    el.numbers[key].readOnly = isAuto;
  }
}

function setMode(mode) {
  state.mode = mode === "auto" ? "auto" : "manual";
  updateModeControls();

  if (state.mode === "auto" && hasSample()) {
    setFilters(sampleToViewingFilters(state.heldSample || state.lastSample));
  }
}

function enterManualMode() {
  if (state.mode !== "manual") {
    setMode("manual");
  }
}

function sampleToViewingFilters(sample) {
  if (!sample) return { c: 0, m: 0, y: 0 };

  const r = Math.max(sample.r, 1);
  const g = Math.max(sample.g, 1);
  const b = Math.max(sample.b, 1);
  const target = Math.min(r, g, b);

  return {
    c: clamp(100 * Math.log10(r / target), 0, 300),
    m: clamp(100 * Math.log10(g / target), 0, 300),
    y: clamp(100 * Math.log10(b / target), 0, 300),
  };
}

function updateSwatches() {
  const sample = state.heldSample || state.lastSample;
  const filtered = filteredRgb(sample);

  el.rawSwatch.style.background = rgbCss(sample);
  el.filteredSwatch.style.background = rgbCss(filtered);
  el.rawReadout.value = rgbReadout(sample);
  el.filteredReadout.value = rgbReadout(filtered);
}

function updateCalculations() {
  const delta = { ...state.filters };
  const current = {
    c: readNumber(el.currentC),
    m: readNumber(el.currentM),
    y: readNumber(el.currentY),
  };
  const fullPack = {
    c: current.c + delta.c,
    m: current.m + delta.m,
    y: current.y + delta.y,
  };
  const commonDensity = el.normalizePack.checked
    ? Math.min(fullPack.c, fullPack.m, fullPack.y)
    : 0;
  const recommended = {
    c: Math.max(0, fullPack.c - commonDensity),
    m: Math.max(0, fullPack.m - commonDensity),
    y: Math.max(0, fullPack.y - commonDensity),
  };

  const lumaTransmission =
    LUMA.r * transmission(delta.c) +
    LUMA.g * transmission(delta.m) +
    LUMA.b * transmission(delta.y);
  const viewingStops = stopsFromTransmission(lumaTransmission);
  const currentNeutral = Math.min(current.c, current.m, current.y);
  const finalNeutral = Math.min(recommended.c, recommended.m, recommended.y);
  const neutralStops = (finalNeutral - currentNeutral) / CC_PER_STOP;

  el.deltaPack.value = formatPack(delta);
  el.recommendedPack.value = formatPack(recommended);
  el.viewingStops.value = `${formatStops(viewingStops)} (${(1 / lumaTransmission).toFixed(2)}x)`;
  el.packStops.value = `${formatStops(neutralStops)} exposure time`;
  updateSwatches();
}

function fitCanvasToVideo() {
  const width = el.video.videoWidth || 1280;
  const height = el.video.videoHeight || 720;

  if (el.rawCanvas.width !== width || el.rawCanvas.height !== height) {
    el.rawCanvas.width = width;
    el.rawCanvas.height = height;
    el.viewCanvas.width = width;
    el.viewCanvas.height = height;
  }
}

function sampleCenter(imageData) {
  const { width, height, data } = imageData;
  const box = Math.round(Math.min(width, height) * 0.12);
  const x0 = Math.round(width / 2 - box / 2);
  const y0 = Math.round(height / 2 - box / 2);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = y0; y < y0 + box; y += 1) {
    for (let x = x0; x < x0 + box; x += 1) {
      const offset = (y * width + x) * 4;
      r += data[offset];
      g += data[offset + 1];
      b += data[offset + 2];
      count += 1;
    }
  }

  return {
    r: r / count,
    g: g / count,
    b: b / count,
  };
}

function applyViewingFilter(imageData) {
  const data = imageData.data;
  const tc = transmission(state.filters.c);
  const tm = transmission(state.filters.m);
  const ty = transmission(state.filters.y);

  for (let i = 0; i < data.length; i += 4) {
    data[i] *= tc;
    data[i + 1] *= tm;
    data[i + 2] *= ty;
  }

  return imageData;
}

function drawFrame() {
  if (state.running && !state.frozen && el.video.readyState >= 2) {
    fitCanvasToVideo();
    rawCtx.drawImage(el.video, 0, 0, el.rawCanvas.width, el.rawCanvas.height);
  }

  if (el.rawCanvas.width && el.rawCanvas.height) {
    const imageData = rawCtx.getImageData(0, 0, el.rawCanvas.width, el.rawCanvas.height);
    if (!el.lockSample.checked) {
      state.lastSample = sampleCenter(imageData);
    }
    if (state.mode === "auto" && hasSample()) {
      setFilters(sampleToViewingFilters(state.heldSample || state.lastSample));
    } else {
      updateModeControls();
    }
    viewCtx.putImageData(applyViewingFilter(imageData), 0, 0);
    updateSwatches();
  }

  requestAnimationFrame(drawFrame);
}

async function startCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    state.stream = stream;
    state.running = true;
    state.frozen = false;
    el.video.srcObject = stream;
    await el.video.play();

    el.startCamera.textContent = "Restart camera";
    el.freezeFrame.disabled = false;
    el.freezeFrame.textContent = "Freeze";
    el.cameraMessage.hidden = true;
    updateModeControls();
  } catch (error) {
    el.cameraMessage.hidden = false;
    el.cameraMessage.textContent = `Camera unavailable: ${error.message}`;
  }
}

for (const key of ["c", "m", "y"]) {
  el.sliders[key].addEventListener("input", () => {
    enterManualMode();
    setFilters({ ...state.filters, [key]: el.sliders[key].value });
  });

  el.numbers[key].addEventListener("input", () => {
    enterManualMode();
    setFilters({ ...state.filters, [key]: el.numbers[key].value });
  });
}

for (const input of [el.currentC, el.currentM, el.currentY, el.normalizePack]) {
  input.addEventListener("input", updateCalculations);
  input.addEventListener("change", updateCalculations);
}

el.startCamera.addEventListener("click", startCamera);

el.freezeFrame.addEventListener("click", () => {
  state.frozen = !state.frozen;
  el.freezeFrame.textContent = state.frozen ? "Live" : "Freeze";
});

el.autoBalance.addEventListener("click", () => {
  const sample = state.heldSample || state.lastSample;
  setMode("manual");
  setFilters(sampleToViewingFilters(sample));
});

el.resetFilters.addEventListener("click", () => {
  setMode("manual");
  setFilters({ c: 0, m: 0, y: 0 });
});

el.lockSample.addEventListener("change", () => {
  state.heldSample = el.lockSample.checked ? state.lastSample : null;
  if (state.mode === "auto" && hasSample()) {
    setFilters(sampleToViewingFilters(state.heldSample || state.lastSample));
  }
  updateModeControls();
  updateSwatches();
});

el.manualMode.addEventListener("change", () => {
  if (el.manualMode.checked) {
    setMode("manual");
  }
});

el.autoMode.addEventListener("change", () => {
  if (el.autoMode.checked) {
    setMode("auto");
  }
});

if (!navigator.mediaDevices?.getUserMedia) {
  el.startCamera.disabled = true;
  el.cameraMessage.textContent = "This browser does not expose camera access to web pages.";
}

setFilters({ c: 0, m: 0, y: 0 });
updateModeControls();
requestAnimationFrame(drawFrame);
