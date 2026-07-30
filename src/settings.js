// Persistent settings in localStorage: mouse sensitivity (as a multiplier
// of the default look speed, 0.1x–3x) and steady-aim sensitivity (the
// fraction of look speed used while holding right click, 10%–100%).
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

export function getAimSensMult() {
  const v = Number(data.aimSensMult);
  return v >= 0.1 && v <= 1 ? v : 0.5;
}

export function setAimSensMult(v) {
  data.aimSensMult = Math.min(1, Math.max(0.1, v));
  save();
}
