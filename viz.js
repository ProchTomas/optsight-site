/* ===================================================================
   OptSight landing — Tier-1 algorithm visualizations  (canvas loops)
   -------------------------------------------------------------------
   Each viz is decorative: it illustrates a real capability, makes no
   performance claim, and degrades to a static settled frame under
   prefers-reduced-motion. Registered by [data-viz] on a .viz figure.
   Requires fx-core.js (window.OptSightFX).
   =================================================================== */
(function () {
  "use strict";

  var FX = window.OptSightFX;
  if (!FX) return;

  var P = FX.palette;
  var clamp = FX.clamp, lerp = FX.lerp;

  /* =================================================================
     VIZ 1 — Portfolio optimization (auto-looping demo, no controls).
     Cycle: hold at RISK PARITY (bubbles sized by inverse vol, risk
     bars flat) → drop to EQUAL WEIGHT (same-size bubbles, jagged bars
     = each holding's individual risk) → re-solve back to parity.
     "Held naively some names carry far more risk; risk parity levels it."
     ================================================================= */
  function optimize(fig) {
    var canvas = fig.querySelector(".viz__canvas");
    if (!canvas) return;

    var TICKERS = ["MSFT", "KO", "XOM", "NVDA", "JPM", "PG", "AMD"];
    var N = FX.lite ? 5 : TICKERS.length;
    var STRIP = FX.lite ? 74 : 86;          // top risk-bar band height (px)
    var BOT = 54;                            // bottom control strip (clears play/pause)

    var rand = FX.rng(0xA11CE ^ N);
    var assets = [];
    var corr = [];                           // symmetric correlation matrix
    var balance = 1;                         // 0 = equal weight, 1 = risk parity
    var target = 1, phase = 1, pt = 0;       // 1 = balanced hold, 0 = individual hold
    var PHASE_DUR = 3.7;
    var w = 1, h = 1, cx = 0.5, cy = 0.5;

    function newRegime() {
      for (var i = 0; i < N; i++) assets[i].sigma = lerp(0.12, 0.6, rand());
      for (i = 0; i < N; i++) {
        for (var j = i + 1; j < N; j++) {
          var c = rand() < 0.55 ? lerp(-0.15, 0.25, rand()) : lerp(0.45, 0.85, rand());
          corr[i][j] = corr[j][i] = c;
        }
      }
      recompute();
    }

    function baseR() { return Math.min(w, h) * 0.09; }

    /* weights (equal-weight ⟷ risk-parity blend) + risk shares */
    function recompute() {
      var i, inv = 0;
      for (i = 0; i < N; i++) inv += 1 / assets[i].sigma;
      var eq = 1 / N, riskSum = 0;
      for (i = 0; i < N; i++) {
        var rp = (1 / assets[i].sigma) / inv;      // risk-parity weight
        var wi = lerp(eq, rp, balance);            // blended (sums to 1)
        assets[i].weight = wi;
        assets[i].targetR = baseR() * Math.sqrt(wi * N);
        assets[i].riskRaw = wi * assets[i].sigma;  // ∝ risk contribution
        riskSum += assets[i].riskRaw;
      }
      for (i = 0; i < N; i++) assets[i].risk = assets[i].riskRaw / riskSum;
    }

    function reset() {
      assets = []; corr = [];
      for (var i = 0; i < N; i++) {
        assets.push({
          label: TICKERS[i],
          x: cx + (rand() - 0.5) * w * 0.5,
          y: cy + (rand() - 0.5) * h * 0.35,
          vx: 0, vy: 0, r: baseR(), targetR: baseR(),
          sigma: 0.3, weight: 1 / N, risk: 1 / N, riskRaw: 0
        });
        corr.push(new Array(N).fill(0));
      }
      newRegime();
    }

    function api_resize(nw, nh) {
      w = nw; h = nh; cx = w / 2;
      cy = STRIP + (h - STRIP - BOT) / 2;
      if (!assets.length) reset();
      recompute();
    }

    function step(dt) {
      /* phase machine: hold balanced → hold individual → new regime */
      pt += dt;
      if (pt >= PHASE_DUR) {
        pt = 0;
        if (phase === 1) { phase = 0; target = 0; }       // balanced → individual
        else { phase = 1; target = 1; newRegime(); }      // individual → balanced (new regime)
      }
      balance += (target - balance) * clamp(dt * 1.9, 0, 1);
      recompute();

      var i, j, a, b;
      var kCenter = 2.6;
      var pad = baseR() * 0.85;

      for (i = 0; i < N; i++) {
        a = assets[i];
        a.r += (a.targetR - a.r) * clamp(dt * 4, 0, 1);
        a.fx = (cx - a.x) * kCenter;
        a.fy = (cy - a.y) * kCenter;
      }
      for (i = 0; i < N; i++) {
        a = assets[i];
        for (j = i + 1; j < N; j++) {
          b = assets[j];
          var dx = a.x - b.x, dy = a.y - b.y;
          var d = Math.sqrt(dx * dx + dy * dy) || 0.001;
          var nx = dx / d, ny = dy / d;
          var minD = a.r + b.r + pad;
          if (d < minD) {                          // collision
            var push = (minD - d) * 26;
            a.fx += nx * push; a.fy += ny * push;
            b.fx -= nx * push; b.fy -= ny * push;
          } else if (d < minD * 3.2) {             // soft spacing repulsion
            var sp = (1 - d / (minD * 3.2)) * 120;
            a.fx += nx * sp; a.fy += ny * sp;
            b.fx -= nx * sp; b.fy -= ny * sp;
          }
          var rho = corr[i][j];                    // correlated names diversify apart
          if (rho > 0.35 && d < minD * 2.6) {
            var cf = (rho - 0.35) * (1 - d / (minD * 2.6)) * 1100;
            a.fx += nx * cf; a.fy += ny * cf;
            b.fx -= nx * cf; b.fy -= ny * cf;
          }
        }
      }
      for (i = 0; i < N; i++) {
        a = assets[i];
        a.vx = (a.vx + a.fx * dt) * 0.85;
        a.vy = (a.vy + a.fy * dt) * 0.85;
        a.x += a.vx * dt; a.y += a.vy * dt;
        a.x = clamp(a.x, a.r + 2, w - a.r - 2);
        a.y = clamp(a.y, STRIP + a.r + 6, h - BOT - a.r - 6);   /* stay below the bar band */
      }
    }

    function api_warm(steps) { for (var s = 0; s < steps; s++) step(1 / 60); }

    /* ---- drawing ---- */
    function drawBubbles(ctx) {
      var i, j, a, b;
      for (i = 0; i < N; i++) {
        a = assets[i];
        for (j = i + 1; j < N; j++) {
          if (corr[i][j] > 0.5) {
            b = assets[j];
            ctx.strokeStyle = P.accentGlow + (0.08 + (corr[i][j] - 0.5) * 0.4).toFixed(3) + ")";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (i = 0; i < N; i++) {
        a = assets[i];
        var g = ctx.createRadialGradient(a.x, a.y - a.r * 0.3, a.r * 0.2, a.x, a.y, a.r);
        g.addColorStop(0, P.accentGlow + "0.44)");
        g.addColorStop(1, P.accentGlow + "0.06)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = P.accent; ctx.lineWidth = 1.25; ctx.stroke();
        if (a.r > baseR() * 0.6) {
          ctx.fillStyle = P.text;
          ctx.font = "600 " + Math.round(clamp(a.r * 0.4, 9, 15)) + "px 'IBM Plex Mono', monospace";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(a.label, a.x, a.y);
        }
      }
    }

    /* compact risk-contribution band across the top */
    function drawRiskStrip(ctx) {
      var padX = 16;
      var titleY = 15, barsTop = 26, baseY = STRIP - 17;
      var eqY = barsTop + (baseY - barsTop) * 0.45;   // "equal risk" reference
      var full = (baseY - barsTop) * 0.98;
      var eqShare = 1 / N;
      var innerW = w - padX * 2;
      var gap = Math.max(5, innerW * 0.018);
      var bw = (innerW - gap * (N - 1)) / N;

      ctx.textBaseline = "alphabetic";
      /* title + live mode label */
      ctx.font = "600 10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = P.textDim;
      ctx.globalAlpha = 0.8;
      ctx.textAlign = "left";
      ctx.fillText("RISK  CONTRIBUTION", padX, titleY);
      ctx.globalAlpha = 1;
      var mode = balance <= 0.15 ? "equal weight — unequal risk"
        : balance >= 0.85 ? "risk parity — equal risk"
          : "balancing risk…";
      ctx.fillStyle = P.accent;
      ctx.textAlign = "right";
      ctx.fillText(mode, w - padX, titleY);

      /* dashed equal-risk reference line */
      ctx.strokeStyle = "rgba(140,152,176,0.26)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(padX, eqY); ctx.lineTo(w - padX, eqY); ctx.stroke();
      ctx.setLineDash([]);

      for (var i = 0; i < N; i++) {
        var a = assets[i];
        var hgt = clamp((a.risk / eqShare) * (baseY - eqY), 3, full);
        var x = padX + i * (bw + gap), y = baseY - hgt;
        var over = clamp((a.risk / eqShare - 1) / 1.2, 0, 1);   // above-equal → amber
        ctx.fillStyle = over > 0.05
          ? "rgba(" + Math.round(200 + 40 * over) + "," + Math.round(117 + 48 * over) + "," + Math.round(51 - 20 * over) + ",0.85)"
          : P.accentGlow + "0.8)";
        ctx.fillRect(x, y, bw, hgt);
        ctx.strokeStyle = P.accent; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, Math.max(1, hgt - 1));
        ctx.fillStyle = P.textDim;
        ctx.font = "500 9px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(a.label, x + bw / 2, baseY + 12);
      }

      /* divider between the band and the bubble field */
      ctx.strokeStyle = "rgba(38,45,61,0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, STRIP); ctx.lineTo(w, STRIP); ctx.stroke();
    }

    function draw(ctx) {
      ctx.clearRect(0, 0, w, h);
      drawBubbles(ctx);
      drawRiskStrip(ctx);
    }

    function api_frame(ctx, fw, fh, dt) {
      if (dt > 0) step(dt);
      draw(ctx);
    }

    var ui = fig.querySelector(".viz__ui");
    FX.mount(canvas, {
      resize: api_resize,
      frame: api_frame,
      warm: api_warm
    }, { controls: ui, label: "Portfolio optimization" });
  }

  /* =================================================================
     VIZ 2 — Fundamental ranker: a ticker token drops through a
     decision tree of feature checks (valuation → profitability →
     momentum) into an ADD or PASS bin (ADD = shortlisted into the
     universe, not a buy order). Faint back-trees + caption evoke the
     ensemble. A screen, never a return prediction.
     ================================================================= */
  function tree(fig) {
    var canvas = fig.querySelector(".viz__canvas");
    if (!canvas) return;

    var D = 3;                                     // decision levels ⇒ 8 leaves
    var LEVEL_LABEL = ["VALUATION", "PROFITABILITY", "MOMENTUM"];
    var POOL = ["MSFT", "KO", "NVDA", "XOM", "JPM", "PG", "AMD", "COST", "PEP", "CVX", "ORCL", "WMT"];

    var TOP = 28, BOT = 44, BINH = 34;
    var rand = FX.rng(0x7EE0 ^ D);
    var w = 1, h = 1;
    var nodes = [];                                // nodes[L] = array of {x,y}
    var leafAdd = [];                              // verdict per leaf index (ADD vs PASS)
    var pulses = {};                               // node glow timers
    var addCount = 0, passCount = 0;
    var tok = null, spawnT = 0;

    function popcount(n) { var c = 0; while (n) { c += n & 1; n >>= 1; } return c; }

    function layout() {
      nodes = [];
      var x0 = 16, x1 = w - 16;
      var y0 = TOP + 16, y1 = h - BOT - BINH - 12;
      for (var L = 0; L <= D; L++) {
        var row = [], cnt = Math.pow(2, L);
        for (var k = 0; k < cnt; k++) {
          row.push({
            x: x0 + (x1 - x0) * ((k + 0.5) / cnt),
            y: y0 + (y1 - y0) * (L / D)
          });
        }
        nodes.push(row);
      }
      leafAdd = [];
      for (var i = 0; i < Math.pow(2, D); i++) leafAdd.push(popcount(i) >= 2);  // ≥2 passes ⇒ ADD
    }

    function spawn(parked) {
      var q = lerp(0.25, 0.8, rand());             // token "quality" → pass probability
      var checks = [], k = 0, path = [{ L: 0, k: 0 }];
      for (var L = 0; L < D; L++) {
        var pass = rand() < q;                      // right = pass, left = fail
        checks.push(pass);
        k = k * 2 + (pass ? 1 : 0);
        path.push({ L: L + 1, k: k });
      }
      tok = {
        label: POOL[(rand() * POOL.length) | 0],
        checks: checks, leaf: k, path: path,
        add: leafAdd[k], seg: 0, t: 0, dwell: 0.15, done: false, flash: 0
      };
      if (parked) { tok.seg = D; tok.t = 0; tok.done = true; tok.flash = 1; }
    }

    function reset() {
      addCount = 0; passCount = 0; pulses = {};
      layout();
      spawn(FX.reduced);                            // reduced motion ⇒ park at a leaf
    }

    function api_resize(nw, nh) {
      w = nw; h = nh;
      layout();
      if (!tok) spawn(FX.reduced);
    }

    function nodeAt(seg) { var p = tok.path[seg]; return nodes[p.L][p.k]; }

    function step(dt) {
      for (var key in pulses) { pulses[key] -= dt; if (pulses[key] <= 0) delete pulses[key]; }

      if (!tok) { spawn(false); return; }

      if (tok.done) {
        tok.flash = Math.max(0, tok.flash - dt * 0.7);
        spawnT += dt;
        if (spawnT > 1.0) { spawnT = 0; spawn(false); }
        return;
      }
      if (tok.dwell > 0) { tok.dwell -= dt; return; }

      tok.t += dt * 1.7;
      if (tok.t >= 1) {
        tok.t = 0; tok.seg++;
        if (tok.seg >= D) {
          tok.done = true; tok.flash = 1;
          if (tok.add) addCount++; else passCount++;
          var lp = tok.path[D]; pulses[D + ":" + lp.k] = 0.6;
        } else {
          tok.dwell = 0.2;
          var np = tok.path[tok.seg]; pulses[np.L + ":" + np.k] = 0.5;
        }
      }
    }

    function api_warm() { /* static frame is the parked token; no advance needed */ }

    /* ---- drawing ---- */
    function edge(ctx, a, b, bright) {
      ctx.strokeStyle = bright ? P.accent : "rgba(38,45,61,0.9)";
      ctx.lineWidth = bright ? 2.6 : 1.3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    function drawTree(ctx, ox, oy, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      var L, k;
      /* edges */
      for (L = 0; L < D; L++) {
        for (k = 0; k < nodes[L].length; k++) {
          var p = nodes[L][k];
          var lc = nodes[L + 1][k * 2], rc = nodes[L + 1][k * 2 + 1];
          var bright = alpha === 1 && tok && tok.seg > L &&
            tok.path[L].k === k;
          edge(ctx, { x: p.x + ox, y: p.y + oy }, { x: lc.x + ox, y: lc.y + oy },
            bright && !tok.checks[L]);
          edge(ctx, { x: p.x + ox, y: p.y + oy }, { x: rc.x + ox, y: rc.y + oy },
            bright && tok.checks[L]);
        }
      }
      /* internal nodes (diamonds) */
      for (L = 0; L < D; L++) {
        for (k = 0; k < nodes[L].length; k++) {
          var n = nodes[L][k], key = L + ":" + k, pulse = pulses[key] || 0;
          var r = 9.5 + pulse * 8;
          ctx.beginPath();
          ctx.moveTo(n.x + ox, n.y + oy - r); ctx.lineTo(n.x + ox + r, n.y + oy);
          ctx.lineTo(n.x + ox, n.y + oy + r); ctx.lineTo(n.x + ox - r, n.y + oy);
          ctx.closePath();
          ctx.fillStyle = P.raised; ctx.fill();
          ctx.strokeStyle = pulse > 0 ? P.accent : P.accentDim;
          ctx.lineWidth = 1.4; ctx.stroke();
        }
      }
      ctx.restore();
    }

    function draw(ctx) {
      ctx.clearRect(0, 0, w, h);

      /* title + tallies */
      ctx.textBaseline = "alphabetic";
      ctx.font = "600 10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = P.textDim; ctx.globalAlpha = 0.8; ctx.textAlign = "left";
      ctx.fillText("FUNDAMENTAL  SCREEN", 16, 15); ctx.globalAlpha = 1;
      ctx.textAlign = "right";
      ctx.fillStyle = P.accent; ctx.fillText("ADD " + addCount, w - 92, 15);
      ctx.fillStyle = P.muted; ctx.fillText("PASS " + passCount, w - 16, 15);

      /* level (check) labels — tucked into the empty space left of each row */
      if (!FX.lite && w > 520) {
        ctx.textAlign = "left";
        ctx.font = "500 10px 'IBM Plex Mono', monospace";
        ctx.fillStyle = P.muted;
        for (var L = 0; L < D; L++) {
          ctx.fillText(LEVEL_LABEL[L], 10, nodes[L][0].y + 3);
        }
      }

      /* ensemble: sibling trees fanned out behind the live one */
      drawTree(ctx, -24, -13, 0.22);
      drawTree(ctx, 24, -13, 0.22);
      /* main tree */
      drawTree(ctx, 0, 0, 1);

      /* leaf bins (the decision surface) */
      var leaves = nodes[D], binW = (leaves[1].x - leaves[0].x) * 0.8;
      var binY = h - BOT - BINH;
      for (var i = 0; i < leaves.length; i++) {
        var lx = leaves[i].x, add = leafAdd[i];
        ctx.fillStyle = add ? P.accentGlow + "0.16)" : "rgba(74,85,104,0.12)";
        ctx.strokeStyle = add ? P.accentDim : "rgba(74,85,104,0.55)";
        ctx.lineWidth = 1;
        ctx.fillRect(lx - binW / 2, binY, binW, BINH);
        ctx.strokeRect(lx - binW / 2 + 0.5, binY + 0.5, binW - 1, BINH - 1);
        ctx.fillStyle = add ? P.accent : P.muted;
        ctx.font = "600 10px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(add ? "ADD" : "PASS", lx, binY + BINH / 2);
        ctx.textBaseline = "alphabetic";
      }

      /* the token */
      if (tok) {
        var px, py;
        if (tok.done) {
          var lf = nodes[D][tok.leaf]; px = lf.x; py = h - BOT - BINH / 2;
        } else {
          var a = nodeAt(tok.seg), b = nodeAt(tok.seg + 1);
          px = lerp(a.x, b.x, tok.t); py = lerp(a.y, b.y, tok.t);
        }
        var tr = 16;
        ctx.beginPath(); ctx.arc(px, py, tr, 0, Math.PI * 2);
        ctx.fillStyle = P.raised; ctx.fill();
        ctx.strokeStyle = P.accent; ctx.lineWidth = 1.8; ctx.stroke();
        ctx.fillStyle = P.text;
        ctx.font = "600 11px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(tok.label, px, py);

        /* verdict chip on landing */
        if (tok.done && tok.flash > 0.02) {
          ctx.globalAlpha = clamp(tok.flash, 0, 1);
          ctx.fillStyle = tok.add ? P.accent : P.muted;
          ctx.font = "700 15px 'IBM Plex Mono', monospace";
          ctx.fillText(tok.add ? "ADD" : "PASS", px, py - tr - 12);
          ctx.globalAlpha = 1;
        }
        ctx.textBaseline = "alphabetic";
      }
    }

    function api_frame(ctx, fw, fh, dt) {
      if (dt > 0) step(dt);
      draw(ctx);
    }

    var ui = fig.querySelector(".viz__ui");
    reset();
    FX.mount(canvas, {
      resize: api_resize,
      frame: api_frame,
      warm: api_warm
    }, { controls: ui, label: "Fundamental ranker" });
  }

  /* =================================================================
     VIZ 3 — Funding carry: a balance beam holds a LONG basket and a
     SHORT basket level (market-neutral). Every "8h" the funding clock
     completes and funding coins rain down, bounce off the beam, and roll
     into the baskets; the uneven load tilts the beam and the neutrality
     guard re-levels it. Funding is ± — mechanism only, no yield claim.
     ================================================================= */
  function carry(fig) {
    var canvas = fig.querySelector(".viz__canvas");
    if (!canvas) return;

    var LONGS = ["BTC", "ETH"];
    var SHORTS = ["SOL", "DOGE"];
    var TOP = 44, BOT = 46;
    var PERIOD = 5.2;                              // seconds standing in for 8h

    var rand = FX.rng(0xCA77F);
    var w = 1, h = 1, cx = 0.5;
    var groundY = 0, pivotY = 0, halfLen = 0;

    var angle = 0;                                 // beam tilt (rad)
    var leftLoad = 0, rightLoad = 0;               // funding coins resting in each basket
    var clock = 0, ringFlash = 0;
    var coins = [];                                // funding coins: fall → bounce → roll
    var carryN = 0;                                // simulated funding units collected

    function api_resize(nw, nh) {
      w = nw; h = nh; cx = w / 2;
      groundY = h - BOT - 32;
      pivotY = groundY - Math.min(78, (h - TOP - BOT) * 0.28);
      halfLen = Math.min(w * 0.36, (h - TOP - BOT) * 0.7);
    }

    function fundingEvent() {
      var sign = rand() < 0.85 ? 1 : -1;           // funding usually received, sometimes paid
      ringFlash = 1;
      var n = FX.lite ? 4 : 6;
      for (var i = 0; i < n; i++) {
        coins.push({
          state: "fall",
          x: cx + (rand() - 0.5) * halfLen * 1.5, // rain across the beam span
          y: TOP + 4 + rand() * 14,
          vy: 20 + rand() * 30,
          s: 0, dir: 0, spd: 0, hop: 0, sign: sign, r: 6
        });
      }
    }

    function step(dt) {
      /* 8h funding clock */
      clock += dt / PERIOD;
      if (clock >= 1) { clock -= 1; fundingEvent(); }
      ringFlash = Math.max(0, ringFlash - dt * 1.4);

      var cosA = Math.cos(angle), tanA = Math.tan(angle);
      var beamHalfX = halfLen * cosA;

      for (var i = coins.length - 1; i >= 0; i--) {
        var c = coins[i];
        c.hop = Math.max(0, c.hop - dt * 42);
        if (c.state === "fall") {
          c.vy += 240 * dt;
          c.y += c.vy * dt;
          var beamY = pivotY + (c.x - cx) * tanA;           // beam height under the coin
          if (c.y + c.r >= beamY && Math.abs(c.x - cx) <= beamHalfX) {
            c.state = "roll";
            c.s = (c.x - cx) / (cosA || 1);                 // distance along beam from pivot
            c.dir = c.s >= 0 ? 1 : -1;                      // roll to the basket on its side
            c.spd = 45;
            c.hop = 7;                                      // little bounce on contact
          }
        } else {                                            // rolling downhill into the basket
          c.spd += (95 + 260 * Math.abs(Math.sin(angle))) * dt;
          c.s += c.dir * c.spd * dt;
          if (Math.abs(c.s) >= halfLen * 0.9) {
            if (c.dir > 0) rightLoad += 1; else leftLoad += 1;
            carryN = Math.max(0, carryN + c.sign);
            coins.splice(i, 1);
          }
        }
      }

      /* once the batch has rolled in, the neutrality guard rebalances to level */
      if (coins.length === 0) {
        leftLoad += (0 - leftLoad) * clamp(dt * 1.2, 0, 1);
        rightLoad += (0 - rightLoad) * clamp(dt * 1.2, 0, 1);
      }

      var aTarget = clamp((rightLoad - leftLoad) * 0.05, -0.24, 0.24);
      angle += (aTarget - angle) * clamp(dt * 3, 0, 1);     // gentle beam response
    }

    function api_warm() { /* level static frame is fine */ }

    /* ---- drawing ---- */
    function basket(ctx, ex, ey, syms, side) {
      var hang = 36, bowlR = 28;
      var bx = ex, by = ey + hang;
      ctx.strokeStyle = "#262d3d";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(bx, by); ctx.stroke();
      /* bowl */
      ctx.beginPath(); ctx.arc(bx, by, bowlR, 0, Math.PI, false);
      ctx.strokeStyle = P.accentDim; ctx.lineWidth = 1.6; ctx.stroke();
      /* side label */
      ctx.fillStyle = side === "LONG" ? P.accent : P.textDim;
      ctx.font = "600 11px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillText(side, bx, by + bowlR + 12);
      /* coins */
      for (var i = 0; i < syms.length; i++) {
        var coff = (i - (syms.length - 1) / 2) * 26;
        var ccx = bx + coff, ccy = by + 4;
        ctx.beginPath(); ctx.arc(ccx, ccy, 12, 0, Math.PI * 2);
        ctx.fillStyle = P.raised; ctx.fill();
        ctx.strokeStyle = P.accent; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.fillStyle = P.text; ctx.font = "600 9px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(syms[i], ccx, ccy);
      }
      ctx.textBaseline = "alphabetic";
    }

    function draw(ctx) {
      ctx.clearRect(0, 0, w, h);

      /* --- top-left: net-exposure meter --- */
      var mx = 16, mw = Math.min(190, w * 0.42), my = 26;
      ctx.font = "600 10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = P.textDim; ctx.globalAlpha = 0.8;
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText("NET EXPOSURE", mx, 15); ctx.globalAlpha = 1;
      ctx.strokeStyle = "#262d3d"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + mw, my); ctx.stroke();
      /* centre tick */
      ctx.strokeStyle = P.muted;
      ctx.beginPath(); ctx.moveTo(mx + mw / 2, my - 4); ctx.lineTo(mx + mw / 2, my + 4); ctx.stroke();
      /* needle — deviation from neutral is the live basket imbalance */
      var net = clamp((rightLoad - leftLoad) / 4, -1, 1);
      var nx = mx + mw / 2 + net * (mw / 2 - 2);
      var neutral = Math.abs(net) < 0.06;
      ctx.fillStyle = neutral ? P.accent : P.warning;
      ctx.beginPath(); ctx.arc(nx, my, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = neutral ? P.accent : P.warning;
      ctx.font = "600 9px 'IBM Plex Mono', monospace";
      ctx.fillText(neutral ? "MARKET NEUTRAL" : "REBALANCING", mx, my + 16);

      /* --- top-right: 8h funding clock ring --- */
      var rcx = w - 30, rcy = 24, rr = 13;
      ctx.strokeStyle = "#262d3d"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(rcx, rcy, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = P.accent; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(rcx, rcy, rr, -Math.PI / 2, -Math.PI / 2 + clock * Math.PI * 2); ctx.stroke();
      if (ringFlash > 0) {
        ctx.globalAlpha = ringFlash;
        ctx.beginPath(); ctx.arc(rcx, rcy, rr + 4, 0, Math.PI * 2);
        ctx.strokeStyle = P.accent; ctx.lineWidth = 2; ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = P.textDim; ctx.font = "600 8px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center"; ctx.fillText("8h", rcx, rcy + 3);
      ctx.textAlign = "right"; ctx.fillStyle = P.muted; ctx.font = "500 9px 'IBM Plex Mono', monospace";
      ctx.fillText("FUNDING", rcx - rr - 8, rcy + 3);

      /* --- seesaw --- */
      var lx = cx - halfLen * Math.cos(angle), ly = pivotY - halfLen * Math.sin(angle);
      var rx = cx + halfLen * Math.cos(angle), ry = pivotY + halfLen * Math.sin(angle);
      /* fulcrum */
      ctx.beginPath();
      ctx.moveTo(cx - 18, groundY); ctx.lineTo(cx + 18, groundY); ctx.lineTo(cx, pivotY);
      ctx.closePath();
      ctx.fillStyle = P.raised; ctx.fill();
      ctx.strokeStyle = P.accentDim; ctx.lineWidth = 1.3; ctx.stroke();
      /* beam */
      ctx.strokeStyle = P.accent; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); ctx.stroke();
      ctx.fillStyle = P.accent;
      ctx.beginPath(); ctx.arc(cx, pivotY, 4, 0, Math.PI * 2); ctx.fill();

      /* --- funding coins (raining, then rolling along the beam) --- */
      var cosD = Math.cos(angle), sinD = Math.sin(angle);
      for (var i = 0; i < coins.length; i++) {
        var c = coins[i], px, py;
        if (c.state === "fall") { px = c.x; py = c.y; }
        else { px = cx + c.s * cosD; py = pivotY + c.s * sinD - c.r - c.hop; }
        ctx.beginPath(); ctx.arc(px, py, c.r, 0, Math.PI * 2);
        ctx.fillStyle = c.sign > 0 ? P.accent : P.warning;
        ctx.fill();
        ctx.strokeStyle = "rgba(10,10,10,0.5)"; ctx.lineWidth = 1; ctx.stroke();
      }

      /* baskets (drawn last so coins drop into the bowls) */
      basket(ctx, lx, ly, LONGS, "LONG");
      basket(ctx, rx, ry, SHORTS, "SHORT");

      /* --- carry counter at the base --- */
      ctx.fillStyle = P.textDim; ctx.font = "600 9px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center"; ctx.globalAlpha = 0.85;
      ctx.fillText("CARRY · SIMULATED", cx, groundY + 14); ctx.globalAlpha = 1;
      ctx.fillStyle = P.accent; ctx.font = "600 13px 'IBM Plex Mono', monospace";
      ctx.fillText(carryN + " funding units", cx, groundY + 28);
    }

    function api_frame(ctx, fw, fh, dt) {
      if (dt > 0) step(dt);
      draw(ctx);
    }

    var ui = fig.querySelector(".viz__ui");
    FX.mount(canvas, {
      resize: api_resize,
      frame: api_frame,
      warm: api_warm
    }, { controls: ui, label: "Funding carry" });
  }

  /* =================================================================
     Registry — dispatch each .viz figure to its builder.
     ================================================================= */
  var BUILDERS = {
    optimize: optimize,
    tree: tree,
    carry: carry
  };

  function init() {
    var figs = document.querySelectorAll(".viz[data-viz]");
    Array.prototype.forEach.call(figs, function (fig) {
      var kind = fig.getAttribute("data-viz");
      if (BUILDERS[kind]) {
        try { BUILDERS[kind](fig); } catch (e) { /* never break the page */ }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
