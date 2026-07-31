/* ===================================================================
   OptSight landing — shared interactive harness  (window.OptSightFX)
   -------------------------------------------------------------------
   No build step, no dependencies. Loaded first (defer) so viz.js /
   playground.js / extras.js can share one lazy-canvas + seeded-RNG core.

   Everything here is progressive enhancement:
     - with JS off, the page is fully readable (canvases are decorative).
     - prefers-reduced-motion → one static, pre-settled frame, no loop.
     - canvases only run while scrolled into view and the tab is visible.
   =================================================================== */
(function () {
  "use strict";

  var reduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* mobile / low-power "lite" mode: fewer particles, simpler geometry */
  var lite = (window.matchMedia && window.matchMedia("(max-width: 720px)").matches) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || false;

  /* ---- brand palette (mirrors styles.css tokens) ---- */
  var PALETTE = {
    canvas: "#070910",
    panel: "#0e1117",
    raised: "#141820",
    accent: "#c87533",
    accentDim: "#9a5a26",
    accentGlow: "rgba(200,117,51,",   /* append "<alpha>)" */
    success: "#00d084",
    danger: "#ff3b3b",
    warning: "#f0a500",
    muted: "#4a5568",
    text: "#e2e6f0",
    textDim: "#8c98b0"
  };

  /* ---- tiny math helpers ---- */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---- deterministic seeded PRNG (mulberry32) ----
     rng(seed)() → float in [0,1). Same seed ⇒ identical stream, so the
     playground market and any ?seed= link are perfectly reproducible. */
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* hash an arbitrary string → 32-bit seed (for ?seed=WORD links) */
  function hashSeed(str) {
    var h = 2166136261;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* read ?seed= from the URL (number or word), or null */
  function seedFromURL() {
    try {
      var raw = new URLSearchParams(window.location.search).get("seed");
      if (raw == null || raw === "") return null;
      return /^\d+$/.test(raw) ? (parseInt(raw, 10) >>> 0) : hashSeed(raw);
    } catch (e) { return null; }
  }

  /* ---- lazy rAF canvas harness ----
     mount(canvas, api, opts) where api = {
        resize(w, h)                  // CSS px; ctx is pre-scaled to DPR
        frame(ctx, w, h, dt, t)       // draw one frame; dt=0 ⇒ render only
        warm(steps)                   // optional: advance physics w/o drawing
     }
     opts = { controls, label, autoplay }
     Returns a controller { play, pause, destroy, lite, reduced }.        */
  function mount(canvas, api, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;

    var cssW = 1, cssH = 1, raf = 0, last = 0;
    var running = false;          // rAF actually ticking
    var userPlay = opts.autoplay !== false;
    var inView = false, visible = !document.hidden;

    function fit() {
      var r = canvas.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width));
      var h = Math.max(1, Math.round(r.height));
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cssW = w; cssH = h;
      if (api.resize) api.resize(w, h);
      renderOnce();               // keep a fresh frame after a resize
    }

    function renderOnce() {
      if (api.frame) api.frame(ctx, cssW, cssH, 0, performance.now() / 1000);
    }

    function tick(now) {
      if (!running) return;
      var dt = (now - last) / 1000;
      if (!(dt > 0)) dt = 0;
      if (dt > 0.05) dt = 0.05;   // clamp huge gaps (tab was backgrounded)
      last = now;
      api.frame(ctx, cssW, cssH, dt, now / 1000);
      raf = requestAnimationFrame(tick);
    }

    function sync() {
      var shouldRun = userPlay && inView && visible && !reduced;
      if (shouldRun && !running) {
        running = true; last = performance.now();
        raf = requestAnimationFrame(tick);
      } else if (!shouldRun && running) {
        running = false; cancelAnimationFrame(raf);
      }
      if (btn) {
        btn.setAttribute("aria-pressed", userPlay ? "true" : "false");
        btn.dataset.state = userPlay ? "playing" : "paused";
        btn.title = userPlay ? "Pause" : "Play";
      }
    }

    /* play/pause button (only exists when JS runs → no dead control) */
    var btn = null;
    if (opts.controls && !reduced) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "viz__toggle";
      btn.setAttribute("aria-label", (opts.label ? opts.label + " — " : "") + "play or pause animation");
      btn.addEventListener("click", function () {
        userPlay = !userPlay;
        sync();
      });
      opts.controls.appendChild(btn);
    }

    /* size now + on container resize */
    fit();
    var ro = null;
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(function () { fit(); });
      ro.observe(canvas);
    } else {
      window.addEventListener("resize", fit, { passive: true });
    }

    /* reduced motion: pre-settle + one static frame, never loop */
    if (reduced) {
      if (api.warm) api.warm(lite ? 140 : 220);
      renderOnce();
      return { play: function () {}, pause: function () {}, destroy: cleanup, lite: lite, reduced: true };
    }

    /* run only while visible in the viewport */
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        sync();
      }, { threshold: 0.15 });
      io.observe(canvas);
    } else {
      inView = true;
    }
    document.addEventListener("visibilitychange", function () {
      visible = !document.hidden;
      sync();
    });

    sync();

    function cleanup() {
      running = false;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
    }

    return {
      play: function () { userPlay = true; sync(); },
      pause: function () { userPlay = false; sync(); },
      destroy: cleanup,
      lite: lite,
      reduced: false
    };
  }

  window.OptSightFX = {
    reduced: reduced,
    lite: lite,
    palette: PALETTE,
    clamp: clamp,
    lerp: lerp,
    rng: rng,
    hashSeed: hashSeed,
    seedFromURL: seedFromURL,
    mount: mount
  };
})();
