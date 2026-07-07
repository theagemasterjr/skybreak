// Input: keyboard + mouse state with per-frame edge detection and pointer lock.

const ACTIONS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  ability1: ['KeyQ', 'Digit1'],
  ability2: ['KeyE', 'Digit2'],
  ability3: ['KeyR', 'Digit3'],
  ability4: ['KeyF', 'Digit4'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justKeys = new Set();
    this.justReleasedKeys = new Set();
    this.buttons = new Set();
    this.justButtons = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pointerLocked = false;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.justKeys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.justReleasedKeys.add(e.code);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });

    canvas.addEventListener('mousedown', (e) => {
      this.buttons.add(e.button);
      this.justButtons.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
  }

  requestLock() {
    if (this.pointerLocked) return;
    // may be refused (no user gesture yet, iframe, etc.) — the next canvas
    // click will lock instead, so failures here are fine to ignore
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* ignored */ }
  }

  down(action) {
    if (!this.enabled) return false;
    return ACTIONS[action].some((c) => this.keys.has(c));
  }

  pressed(action) {
    if (!this.enabled) return false;
    return ACTIONS[action].some((c) => this.justKeys.has(c));
  }

  released(action) {
    if (!this.enabled) return false;
    return ACTIONS[action].some((c) => this.justReleasedKeys.has(c));
  }

  attackDown() { return this.enabled && this.buttons.has(0); }
  attackPressed() { return this.enabled && this.justButtons.has(0); }
  altDown() { return this.enabled && this.buttons.has(2); }
  altPressed() { return this.enabled && this.justButtons.has(2); }

  consumeLook() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return [dx, dy];
  }

  // call at the END of each frame
  endFrame() {
    this.justKeys.clear();
    this.justButtons.clear();
    this.justReleasedKeys.clear();
  }
}
