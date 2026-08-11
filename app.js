const CC_PER_STOP = Math.log10(2) * 100;
const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 };

const state = {
  stream: null,
  running: false,
  frozen: false,
  mode: "manual",
  lastSample: null,
  filters: { c: 0, m: 0, y: 0, d: 0 },
};

const el = {
  startCamera: document.querySelector("#startCamera"),
  freezeFrame: document.querySelector("#freezeFrame"),
  autoBalance: document.querySelector("#autoBalance"),
  manualMode: document.querySelector("#manualMode"),
  autoMode: document.querySelector("#autoMode"),
  resetFilters: document.querySelector("#resetFilters"),
  cameraMessage: document.querySelector("#cameraMessage"),
  video: document.querySelector("#camera"),
  rawCanvas: document.querySelector("#rawCanvas"),
  viewCanvas: document.querySelector("#viewCanvas"),
  rawSwatch: document.querySelector("#rawSwatch"),
  filteredSwatch: document.querySelector("#filteredSwatch"),
  rawReadout: document.querySelector("#rawReadout"),
  filteredReadout: document.querySelector("#filteredReadout"),
  filterMove: document.querySelector("#filterMove"),
  deltaPack: document.querySelector("#deltaPack"),
  myCorrection: document.querySelector("#myCorrection"),
  recommendedPack: document.querySelector("#recommendedPack"),
  viewingStops: document.querySelector("#viewingStops"),
  packStops: document.querySelector("#packStops"),
  cyanHandling: document.querySelector("#cyanHandling"),
  currentM: document.querySelector("#currentM"),
  currentY: document.querySelector("#currentY"),
  sliders: {
    c: document.querySelector("#cyan"),
    m: document.querySelector("#magenta"),
    y: document.querySelector("#yellow"),
    d: document.querySelector("#density"),
  },
  numbers: {
    c: document.querySelector("#cyanNumber"),
    m: document.querySelector("#magentaNumber"),
    y: document.querySelector("#yellowNumber"),
    d: document.querySelector("#densityNumber"),
  },
};

const rawCtx = el.rawCanvas.getContext("2d", { willReadFrequently: true });
const viewCtx = el.viewCanvas.getContext("2d", { willReadFrequently: true });

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function roundPack(value) {
  return Math.round(value * 2) / 2;
}

function readPackNumber(input) {
  return roundPack(clamp(Number.parseFloat(input.value), 0, 300));
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

function formatMyPack(pack) {
  return `M ${roundPack(pack.m)} / Y ${roundPack(pack.y)}`;
}

function formatSignedFilter(value, label) {
  const rounded = roundPack(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}${label}`;
}

function formatDarkroomMove(move) {
  return `Add ${formatSignedFilter(move.y, "Y")} and ${formatSignedFilter(move.m, "M")}`;
}

function viewingFiltersToMyMove(filters) {
  return {
    m: roundPack(filters.c - filters.m),
    y: roundPack(filters.c - filters.y),
  };
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
  const td = transmission(filters.d);
  return {
    r: rgb.r * transmission(filters.c) * td,
    g: rgb.g * transmission(filters.m) * td,
    b: rgb.b * transmission(filters.y) * td,
  };
}

function setFilters(nextFilters) {
  for (const key of ["c", "m", "y", "d"]) {
    const min = key === "d" ? -120 : 0;
    const rawValue = key in nextFilters ? nextFilters[key] : state.filters[key];
    const value = roundPack(clamp(Number.parseFloat(rawValue), min, 300));
    state.filters[key] = value;
    el.sliders[key].value = Math.min(value, Number(el.sliders[key].max));
    el.numbers[key].value = roundPack(value);
  }
  updateCalculations();
}

function hasSample() {
  return Boolean(state.lastSample);
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
    setFilters(sampleToViewingFilters(state.lastSample));
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
  const sample = state.lastSample;
  const filtered = filteredRgb(sample);

  el.rawSwatch.style.background = rgbCss(sample);
  el.filteredSwatch.style.background = rgbCss(filtered);
  el.rawReadout.value = rgbReadout(sample);
  el.filteredReadout.value = rgbReadout(filtered);
}

function updateCalculations() {
  const delta = {
    c: state.filters.c,
    m: state.filters.m,
    y: state.filters.y,
  };
  const density = state.filters.d;
  const current = {
    m: readPackNumber(el.currentM),
    y: readPackNumber(el.currentY),
  };
  const move = viewingFiltersToMyMove(delta);
  const unclampedPack = {
    m: current.m + move.m,
    y: current.y + move.y,
  };
  const under = ["m", "y"]
    .filter((key) => unclampedPack[key] < 0)
    .map((key) => `${key.toUpperCase()} ${roundPack(unclampedPack[key])}`);
  const recommended = {
    m: Math.max(0, unclampedPack.m),
    y: Math.max(0, unclampedPack.y),
  };
  const cyanHandling = under.length
    ? `C is not dialed; ${under.join(" / ")} under range`
    : `C is not dialed; C viewing adds equal M/Y`;

  const lumaTransmission =
    LUMA.r * transmission(delta.c + density) +
    LUMA.g * transmission(delta.m + density) +
    LUMA.b * transmission(delta.y + density);
  const viewingStops = stopsFromTransmission(lumaTransmission);
  const densityStops = density / CC_PER_STOP;
  const densityMultiplier = 2 ** densityStops;

  const moveText = formatDarkroomMove(move);
  el.filterMove.value = moveText;
  el.deltaPack.value = formatPack(delta);
  el.myCorrection.value = moveText;
  el.recommendedPack.value = formatMyPack(recommended);
  el.viewingStops.value = `${formatStops(viewingStops)} (${(1 / lumaTransmission).toFixed(2)}x)`;
  el.packStops.value = `${formatStops(densityStops)} (${densityMultiplier.toFixed(2)}x time)`;
  el.cyanHandling.value = cyanHandling;
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
  const td = transmission(state.filters.d);
  const tc = transmission(state.filters.c) * td;
  const tm = transmission(state.filters.m) * td;
  const ty = transmission(state.filters.y) * td;

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
    state.lastSample = sampleCenter(imageData);
    if (state.mode === "auto" && hasSample()) {
      setFilters(sampleToViewingFilters(state.lastSample));
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
    el.freezeFrame.textContent = "Hold image";
    el.cameraMessage.hidden = true;
    updateModeControls();
  } catch (error) {
    el.cameraMessage.hidden = false;
    el.cameraMessage.textContent = `Camera unavailable: ${error.message}`;
  }
}

for (const key of ["c", "m", "y", "d"]) {
  el.sliders[key].addEventListener("input", () => {
    if (key !== "d") {
      enterManualMode();
    }
    setFilters({ ...state.filters, [key]: el.sliders[key].value });
  });

  el.numbers[key].addEventListener("input", () => {
    if (key !== "d") {
      enterManualMode();
    }
    setFilters({ ...state.filters, [key]: el.numbers[key].value });
  });
}

for (const input of [el.currentM, el.currentY]) {
  input.addEventListener("input", updateCalculations);
  input.addEventListener("change", updateCalculations);
}

el.startCamera.addEventListener("click", startCamera);

el.freezeFrame.addEventListener("click", () => {
  state.frozen = !state.frozen;
  el.freezeFrame.textContent = state.frozen ? "Live image" : "Hold image";
});

el.autoBalance.addEventListener("click", () => {
  const sample = state.lastSample;
  setMode("manual");
  setFilters(sampleToViewingFilters(sample));
});

el.resetFilters.addEventListener("click", () => {
  setMode("manual");
  setFilters({ c: 0, m: 0, y: 0, d: 0 });
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

setFilters({ c: 0, m: 0, y: 0, d: 0 });
updateModeControls();
requestAnimationFrame(drawFrame);
