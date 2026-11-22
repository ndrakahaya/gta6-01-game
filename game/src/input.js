// Keyboard + mouse state with pointer lock.
// Tracks raw key state, per-frame mouse deltas, and a "pressed this frame" set so one-shot
// actions (enter car, fire, pause) trigger exactly once per press rather than every frame.

/**
 * Unified input manager for keyboard, mouse buttons and pointer-lock mouse look.
 * Call endFrame() once per frame, after every system has read the frame's input.
 */
export class Input {
  constructor(domElement) {
    this.dom = domElement;

    // Held state.
    this.keys = new Set();      // key codes currently down
    this.buttons = new Set();   // mouse buttons currently down

    // Edge state, valid for a single frame.
    this.pressed = new Set();   // keys that went down this frame
    this.clicked = new Set();   // mouse buttons that went down this frame

    // Accumulated movement since the last endFrame().
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;

    this.locked = false;        // whether the pointer is locked to the game canvas
    this.enabled = true;        // gated off while menus/pause screens are open
    this._listeners = [];       // [target, type, fn] triples, kept for clean teardown

    // Register a listener and remember it so dispose() can remove everything.
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._listeners.push([target, type, fn]);
    };

    on(window, 'keydown', (e) => {
      if (!this.enabled) return;
      const code = e.code;
      // Tab and (while playing) Space would otherwise scroll the page or move focus.
      if (code === 'Tab' || (code === 'Space' && this.locked)) e.preventDefault();
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    });

    on(window, 'keyup', (e) => {
      this.keys.delete(e.code);
    });

    // Losing focus mid-keypress would otherwise leave keys stuck down.
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
      if (this.locked) {
        this.onLock?.();
      } else {
        // Key state is meaningless once the pointer unlocks; drop it and notify.
        this.keys.clear();
        this.buttons.clear();
        this.onUnlock?.();
      }
    });

    // Suppress the browser context menu so right-click can be a game action.
    on(document, 'contextmenu', (e) => e.preventDefault());
  }

  // ===== POINTER LOCK =====

  /** Request pointer lock on the game canvas (must be called from a user gesture). */
  requestLock() {
    if (!this.locked && this.dom.requestPointerLock) this.dom.requestPointerLock();
  }

  /** Release pointer lock, e.g. when opening the pause menu. */
  releaseLock() {
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  // ===== STATE QUERIES =====

  /** Is a key currently held down? */
  key(code) { return this.keys.has(code); }

  /** Did a key go down this frame? (edge-triggered, one frame only) */
  hit(code) { return this.pressed.has(code); }

  /** Is a mouse button currently held down? */
  mouse(btn) { return this.buttons.has(btn); }

  /** Did a mouse button go down this frame? (edge-triggered, one frame only) */
  clickedOnce(btn) { return this.clicked.has(btn); }

  /**
   * Signed axis from two keys: +1 when the positive key is held, -1 for the negative key,
   * 0 when neither or both are held.
   */
  axis(neg, pos) {
    return (this.key(pos) ? 1 : 0) - (this.key(neg) ? 1 : 0);
  }

  // ===== FRAME LIFECYCLE =====

  /** Clear the per-frame edge and delta state. Call once per frame, after all readers. */
  endFrame() {
    this.pressed.clear();
    this.clicked.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  /** Remove every listener this instance registered. */
  dispose() {
    for (const [target, type, fn] of this._listeners) {
      target.removeEventListener(type, fn);
    }
    this._listeners.length = 0;
  }
}