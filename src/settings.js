// Persistent settings in localStorage: mouse sensitivity (as a multiplier
// of the default look speed, 0.1x–3x).
const KEY = 'skybreak_settings_v1';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt or unavailable */ }
  return {};
}

const data = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode */ }
}

export function getSensMult() {
  const v = Number(data.sensMult);
  return v >= 0.1 && v <= 3 ? v : 1;
}

export function setSensMult(v) {
  data.sensMult = Math.min(3, Math.max(0.1, v));
  save();
}
