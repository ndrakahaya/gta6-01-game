// Keyboard + mouse state with pointer lock. Keeps raw key state, mouse delta and a
// "pressed this frame" set so actions (enter car, fire, pause) fire once per press.

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.buttons = new Set();
    this.clicked = new Set();
    this.enabled = true;
    this._listeners = [];

    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._listeners.push([target, type, fn]);
    };

    on(window, 'keydown', (e) => {
      if (!this.enabled) return;
      const code = e.code;
      if (code === 'Tab' || (code === 'Space' && this.locked)) e.preventDefault();
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    });
    on(window, 'keyup', (e) => {
      this.keys.delete(e.code);
    });
    on(window, 'blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    on(document, 'mousedown', (e) => {
      if (!this.enabled) return;
      this.buttons.add(e.button);
      this.clicked.add(e.button);
    });
    on(document, 'mouseup', (e) => {
      this.buttons.delete(e.button);
    });
    on(document, 'wheel', (e) => {
      this.wheel += e.deltaY;
    }, { passive: true });
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) {
        this.keys.clear();
        this.buttons.clear();
        this.onUnlock?.();
      } else {
        this.onLock?.();
      }
    });
    on(document, 'contextmenu', (e) => e.preventDefault());
  }

  requestLock() {
    if (!this.locked && this.dom.requestPointerLock) this.dom.requestPointerLock();
  }

  releaseLock() {
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  key(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  mouse(btn) { return this.buttons.has(btn); }
  clickedOnce(btn) { return this.clicked.has(btn); }

  axis(neg, pos) {
    return (this.key(pos) ? 1 : 0) - (this.key(neg) ? 1 : 0);
  }

  /** Call once per frame, after all systems read the frame's input. */
  endFrame() {
    this.pressed.clear();
    this.clicked.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
