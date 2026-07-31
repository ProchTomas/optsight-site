/* ===================================================================
   OptSight playground — "Beat the bots" (time-stepped, rebalancing)
   -------------------------------------------------------------------
   The market plays forward session by session. Bots rebalance on a fixed
   interval using only info up to "now" (Momentum rotates all-in to the
   best trailing performer; OptSight re-solves equal-risk-contribution; Equal holds
   1/N). You rebalance whenever you PAUSE. Every participant's live
   allocation is shown so the strategies are legible over time.

   Deterministic per seed (fairness-tuned in a headless harness). The risk-
   parity bot is NOT built to win — Momentum beats it on ~half of seeds.
   Simulated & fictional — entertainment only, not investment advice.
   Requires fx-core.js + sim-core.js.
   =================================================================== */
(function () {
  "use strict";

  var FX = window.OptSightFX, Sim = window.OptSightSim;
  if (!FX || !Sim) return;
  var clamp = FX.clamp, lerp = FX.lerp, P = FX.palette;

  /* asset palette — kept distinct from the participant colours below */
  var ACOL = ["#4a9e8f", "#9b7ede", "#d15b7a", "#c9b458"];     // teal / violet / rose / olive
  var PARTS = [
    { key: "you", label: "You", color: "#c87533", kind: null },
    { key: "opt", label: "OptSight", color: "#6ea8ff", kind: "riskparity" },
    { key: "eq", label: "Equal", color: "#8c98b0", kind: "equal" },
    { key: "mom", label: "Momentum", color: "#f0a500", kind: "momentum" }
  ];

  function euro(v) { return "€" + Math.round(v).toLocaleString("en-US"); }
  function pct(x) { return (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%"; }

  function build(root) {
    var cfg = Object.assign({}, Sim.DEF);
    var canvas = root.querySelector(".play2__canvas");
    var allocEl = root.querySelector(".play__alloc");
    var botsEl = root.querySelector(".play2__bots");
    var scoreEl = root.querySelector(".play2__score");
    var legendEl = root.querySelector(".play2__legend");
    var noteEl = root.querySelector(".play2__note");
    var sessionEl = root.querySelector(".play2__session");
    var seedEl = root.querySelector(".play2__seed");
    var hintEl = root.querySelector(".play2__hint");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");

    var btn = {};
    ["play", "step", "skip", "restart", "new", "copy"].forEach(function (a) {
      btn[a] = root.querySelector('[data-act="' + a + '"]');
    });

    var seed = 1, assets = [], parts = [], userW = [];
    var sliders = [], statEls = [];
    var t = 0, playing = false, ended = false, loop = 0, acc = 0, last = 0;
    var SPEED = 4.5;                            // sessions per second
    var cssW = 1, cssH = 1;

    /* ---------- asset legend (built once) ---------- */
    function buildLegend() {
      legendEl.innerHTML = "";
      cfg.NAMES.forEach(function (nm, i) {
        var s = document.createElement("span");
        s.className = "play2__chip";
        s.innerHTML = '<i style="background:' + ACOL[i] + '"></i>' + nm;
        legendEl.appendChild(s);
      });
    }

    /* ---------- your allocation sliders ---------- */
    function buildAlloc() {
      allocEl.innerHTML = ""; sliders = []; statEls = [];
      cfg.NAMES.forEach(function (nm, i) {
        var row = document.createElement("div");
        row.className = "alloc-row";
        row.innerHTML =
          '<span class="alloc-name"><i style="background:' + ACOL[i] + '"></i>' + nm + '</span>' +
          '<input type="range" min="0" max="100" value="25" aria-label="' + nm + ' allocation" />' +
          '<span class="alloc-pct">25%</span>' +
          '<span class="alloc-stat"></span>';
        var input = row.querySelector("input");
        input.addEventListener("input", refreshWeights);
        sliders.push(input);
        statEls.push(row.querySelector(".alloc-stat"));
        allocEl.appendChild(row);
      });
      refreshWeights();
    }

    function refreshWeights() {
      var vals = sliders.map(function (s) { return parseFloat(s.value) || 0; });
      var sum = vals.reduce(function (a, b) { return a + b; }, 0);
      userW = vals.map(function (v) { return sum > 0 ? v / sum : 1 / vals.length; });
      var rows = allocEl.querySelectorAll(".alloc-row");
      for (var i = 0; i < rows.length; i++)
        rows[i].querySelector(".alloc-pct").textContent = Math.round(userW[i] * 100) + "%";
      var you = parts[0];
      if (you) { you.cur = userW.slice(); updatePanel(); }
    }

    /* ---------- participant weight bars (allocation only) ---------- */
    function buildPanel() {
      botsEl.innerHTML = "";
      parts.forEach(function (p) {
        var row = document.createElement("div");
        row.className = "bot-row";
        var segs = "";
        for (var i = 0; i < cfg.NAMES.length; i++)
          segs += '<span class="bot-seg" style="background:' + ACOL[i] + '"></span>';
        row.innerHTML =
          '<span class="bot-name"><i style="background:' + p.color + '"></i>' + p.label + '</span>' +
          '<span class="bot-bar">' + segs + '</span>';
        p.barSegs = row.querySelectorAll(".bot-seg");
        botsEl.appendChild(row);
      });
    }

    /* ---------- standings table (below the chart) ---------- */
    function buildScoreboard() {
      if (!scoreEl) return;
      scoreEl.innerHTML = "";
      parts.forEach(function (p) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td class="sc-rank"></td>' +
          '<td class="sc-name"><i style="background:' + p.color + '"></i>' + p.label + '</td>' +
          '<td class="sc-val"></td>' +
          '<td class="sc-ret"></td>' +
          '<td class="sc-dd"></td>';
        p.scRow = tr;
        p.scRank = tr.querySelector(".sc-rank");
        p.scVal = tr.querySelector(".sc-val");
        p.scRet = tr.querySelector(".sc-ret");
        p.scDD = tr.querySelector(".sc-dd");
        scoreEl.appendChild(tr);
      });
    }

    function updatePanel() {
      if (!parts.length) return;
      /* allocation bars */
      parts.forEach(function (p) {
        var w = p.cur || [];
        for (var i = 0; i < p.barSegs.length; i++)
          p.barSegs[i].style.width = ((w[i] || 0) * 100).toFixed(1) + "%";
      });

      /* standings — reorder rows by value, fill return + drawdown */
      var ranked = parts.slice().sort(function (a, b) {
        return b.V[b.V.length - 1] - a.V[a.V.length - 1];
      });
      ranked.forEach(function (p, i) {
        if (scoreEl) scoreEl.appendChild(p.scRow);          // reorder into rank order
        var fin = p.V[p.V.length - 1], ret = fin / cfg.START - 1;
        p.scRank.textContent = "#" + (i + 1);
        p.scVal.textContent = euro(fin);
        p.scRet.textContent = pct(ret);
        p.scRet.className = "sc-ret " + (ret >= 0 ? "up" : "down");
        p.scDD.textContent = pct(p.dd);
        p.scRow.classList.toggle("is-leader", i === 0);
        p.scRow.classList.toggle("is-you", p.key === "you");
      });

      /* per-asset info next to each slider (trend · vol · level) */
      var abs = cfg.WARMUP + t;
      for (var k = 0; k < assets.length; k++) {
        if (!statEls[k]) continue;
        var a = assets[k];
        var j0 = Math.max(0, abs - cfg.MOM_LB);
        var tr = a.price[abs] / a.price[j0] - 1;
        var s0 = Math.max(1, abs - cfg.VOL_LB + 1), m = 0, c = 0, kk;
        for (kk = s0; kk <= abs; kk++) { m += a.rets[kk]; c++; }
        m /= (c || 1);
        var v = 0;
        for (kk = s0; kk <= abs; kk++) { var d = a.rets[kk] - m; v += d * d; }
        v = Math.sqrt(v / (c || 1)) * 100;
        statEls[k].textContent = "trend " + pct(tr) + "  ·  vol " + v.toFixed(1) +
          "%  ·  lvl " + Math.round(a.price[abs]);
      }
    }

    /* ---------- market + reset ---------- */
    function newMarket(s) {
      cancelAnimationFrame(loop); playing = false;
      seed = s >>> 0;
      assets = Sim.buildMarket(seed, cfg);
      buildAlloc();
      reset();
      setSeedURL();
      if (noteEl) noteEl.textContent = "";
    }

    function reset() {
      cancelAnimationFrame(loop); playing = false; ended = false; t = 0; acc = 0;
      parts = PARTS.map(function (d) {
        return {
          key: d.key, label: d.label, color: d.color, def: d,
          V: [cfg.START], dd: 0,
          cur: d.kind ? Sim.weights(d.kind, assets, cfg.WARMUP, cfg) : userW.slice()
        };
      });
      buildPanel();
      buildScoreboard();
      setControls();
      updatePanel(); updateSession(); redraw();
    }

    /* ---------- one session forward ---------- */
    function step() {
      if (t >= cfg.GAME) return false;
      t++;
      var abs = cfg.WARMUP + t;
      parts.forEach(function (p) {
        if (p.def.kind) {
          if ((t - 1) % cfg.REBAL === 0) p.cur = Sim.weights(p.def.kind, assets, abs - 1, cfg);
        } else {
          p.cur = userW.slice();               // your fixed weights (changed only when paused)
        }
        var pr = 0;
        for (var i = 0; i < assets.length; i++) pr += p.cur[i] * assets[i].rets[abs];
        p.V.push(p.V[p.V.length - 1] * (1 + pr));
        p.dd = Sim.maxDD(p.V);
      });
      if (t >= cfg.GAME) finish();
      return true;
    }

    function finish() {
      playing = false; ended = true;
      cancelAnimationFrame(loop);
      setControls();
      var ranked = parts.slice().sort(function (a, b) {
        return b.V[b.V.length - 1] - a.V[a.V.length - 1];
      });
      var you = ranked.findIndex(function (p) { return p.key === "you"; }) + 1;
      var steady = parts.slice().sort(function (a, b) { return b.dd - a.dd; })[0];
      if (noteEl) noteEl.innerHTML =
        "Final — you placed <strong>#" + you + "</strong> of " + parts.length +
        ". Steadiest ride: <strong>" + steady.label + "</strong> (smallest drawdown, " + pct(steady.dd) +
        "). Risk parity isn’t built to win every seed — it’s built to stay balanced. New seed, new story.";
    }

    /* ---------- play loop ---------- */
    function tick(now) {
      if (!playing) return;
      var dt = (now - last) / 1000; last = now;
      if (dt > 0.25) dt = 0.25;
      acc += dt * SPEED;
      var did = false;
      while (acc >= 1 && t < cfg.GAME) { acc -= 1; step(); did = true; }
      if (did) { updatePanel(); updateSession(); redraw(); }
      if (playing && t < cfg.GAME) loop = requestAnimationFrame(tick);
    }

    function play() {
      if (ended || t >= cfg.GAME || FX.reduced) return;
      playing = true; last = performance.now(); acc = 0;
      setControls();
      loop = requestAnimationFrame(tick);
    }
    function pause() { playing = false; cancelAnimationFrame(loop); setControls(); }

    function setControls() {
      if (btn.play) {
        btn.play.textContent = playing ? "Pause" : "Play";
        btn.play.disabled = FX.reduced || ended;
      }
      if (btn.step) btn.step.disabled = playing || ended;
      if (btn.skip) btn.skip.disabled = ended;
      var lock = playing;                       // sliders editable only when paused/idle
      sliders.forEach(function (s) { s.disabled = lock; });
      allocEl.classList.toggle("is-locked", lock);
      if (hintEl) hintEl.textContent = playing
        ? "Paused rebalancing — pause the game to adjust your split."
        : "Rebalance your split, then Play. Bots rebalance every " + cfg.REBAL + " sessions.";
    }

    function updateSession() {
      if (sessionEl) sessionEl.textContent = "Session " + t + " / " + cfg.GAME;
    }

    /* ---------- chart ---------- */
    function fit() {
      var r = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = Math.max(1, Math.round(r.width));
      cssH = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    function redraw() {
      var w = cssW, h = cssH;
      ctx.clearRect(0, 0, w, h);
      var padL = 12, padR = 104, padT = 22, padB = 18;
      var x0 = padL, x1 = w - padR, y0 = h - padB, y1 = padT;
      var nPts = cfg.GAME + 1;                   // full x-axis (fixed) so lines grow left→right
      var mn = Infinity, mx = -Infinity, i, j;
      for (i = 0; i < parts.length; i++)
        for (j = 0; j < parts[i].V.length; j++) {
          var v = parts[i].V[j];
          if (v < mn) mn = v; if (v > mx) mx = v;
        }
      if (!isFinite(mn)) { mn = cfg.START * 0.9; mx = cfg.START * 1.1; }
      var pad = (mx - mn) * 0.08 || 1; mn -= pad; mx += pad;
      function X(k) { return lerp(x0, x1, nPts <= 1 ? 0 : k / (nPts - 1)); }
      function Y(val) { return lerp(y0, y1, (val - mn) / (mx - mn)); }

      /* baseline (starting capital) */
      if (cfg.START >= mn && cfg.START <= mx) {
        ctx.strokeStyle = "rgba(140,152,176,0.22)"; ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x0, Y(cfg.START)); ctx.lineTo(x1, Y(cfg.START)); ctx.stroke();
        ctx.setLineDash([]);
      }
      /* "now" marker */
      if (t > 0) {
        ctx.strokeStyle = "rgba(200,117,51,0.25)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(t), y1); ctx.lineTo(X(t), y0); ctx.stroke();
      }
      /* title */
      ctx.fillStyle = P.textDim; ctx.globalAlpha = 0.8;
      ctx.font = "600 10px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText("EQUITY · €" + cfg.START.toLocaleString("en-US") + " START", padL, 13);
      ctx.globalAlpha = 1;

      /* equity lines up to t */
      var order = parts.slice().sort(function (a, b) {
        return a.V[a.V.length - 1] - b.V[b.V.length - 1];   // draw leaders last (on top)
      });
      order.forEach(function (p) {
        ctx.strokeStyle = p.color; ctx.lineWidth = p.key === "you" ? 2.6 : 1.8;
        ctx.beginPath();
        for (var k = 0; k < p.V.length; k++) {
          var xx = X(k), yy = Y(p.V[k]);
          if (k === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        var lastX = X(p.V.length - 1), lastY = Y(p.V[p.V.length - 1]);
        ctx.beginPath(); ctx.arc(lastX, lastY, p.key === "you" ? 3.5 : 2.6, 0, Math.PI * 2);
        ctx.fillStyle = p.color; ctx.fill();
        ctx.font = "600 10px 'IBM Plex Mono', monospace";
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(p.label + " " + euro(p.V[p.V.length - 1]), lastX + 6,
          clamp(lastY, y1 + 4, y0 - 4));
      });
    }

    /* ---------- seed / share ---------- */
    function setSeedURL() {
      try {
        var u = new URL(window.location.href);
        u.searchParams.set("seed", seed);
        history.replaceState(null, "", u);
      } catch (e) { /* ignore */ }
      if (seedEl) seedEl.textContent = "SEED #" + seed;
    }
    function toast(msg) {
      var el = document.getElementById("toast");
      if (!el) return;
      el.textContent = msg; el.classList.add("is-show");
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { el.classList.remove("is-show"); }, 2600);
    }

    /* ---------- wire up ---------- */
    if (btn.play) btn.play.addEventListener("click", function () { playing ? pause() : play(); });
    if (btn.step) btn.step.addEventListener("click", function () {
      if (playing || ended) return;
      step(); updatePanel(); updateSession(); redraw();
    });
    if (btn.skip) btn.skip.addEventListener("click", function () {
      pause(); while (t < cfg.GAME) step(); updatePanel(); updateSession(); redraw();
    });
    if (btn.restart) btn.restart.addEventListener("click", reset);
    if (btn.new) btn.new.addEventListener("click", function () { newMarket((Math.random() * 1e9) >>> 0); });
    if (btn.copy) btn.copy.addEventListener("click", function () {
      var url = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(url).then(
          function () { toast("Link copied — challenge a friend to beat your seed."); },
          function () { toast(url); });
      else toast(url);
    });

    if ("ResizeObserver" in window) new ResizeObserver(fit).observe(canvas);
    else window.addEventListener("resize", fit, { passive: true });
    document.addEventListener("visibilitychange", function () { if (document.hidden) pause(); });

    buildLegend();
    var initial = FX.seedFromURL();
    newMarket(initial != null ? initial : ((Math.random() * 1e9) >>> 0));
    fit();
  }

  function init() {
    var el = document.getElementById("play-app");
    if (el) { try { build(el); } catch (e) { /* never break the page */ } }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
