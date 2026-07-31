/* ===================================================================
   OptSight playground — pure simulation core (browser + Node)
   -------------------------------------------------------------------
   No DOM, no globals beyond the export. Deterministic given a seed, so a
   shared ?seed= reproduces identical bot behaviour; the human player's
   pause-and-rebalance choices are the only variance. Kept a pure function
   of (market, t) so it is verifiable headlessly (see the fairness harness).
   =================================================================== */
(function (global) {
  "use strict";

  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(r) {
    var u1 = Math.max(1e-9, r()), u2 = r();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  var DEF = {
    NAMES: ["ASTRA", "KRON", "VOLT", "HELIX"],
    WARMUP: 20,        // hidden history everyone can see before session 0
    GAME: 48,          // playable sessions
    START: 10000,
    MOM_LB: 8,         // momentum trailing-return window
    VOL_LB: 16,        // risk-parity trailing-vol window
    REBAL: 6,          // bot rebalance interval (sessions)
    MU: [-0.003, 0.009],
    SIG: [0.014, 0.05],
    SEG: [7, 13],      // drift-regime length (sessions) — leadership rotates
    MR: 0.06,          // short-term reversal: a recent run-up fades next regime
    MRW: 8             // reversal lookback
  };

  /* build the full seeded price paths (warmup + game).
     Drift is piecewise (regimes rotate) with short-term reversal, so chasing
     the recent winner gets whipsawed — no secular trend to simply ride. */
  function buildMarket(seed, cfg) {
    cfg = cfg || DEF;
    var r = rng(seed >>> 0), n = cfg.NAMES.length, assets = [];
    var total = cfg.WARMUP + cfg.GAME;
    for (var i = 0; i < n; i++) {
      var sig = lerp(cfg.SIG[0], cfg.SIG[1], r());
      var p = [100], rets = [0];                 // rets[t] = return into price[t]
      var mu = lerp(cfg.MU[0], cfg.MU[1], r());
      var segLeft = cfg.SEG[0] + Math.floor(r() * (cfg.SEG[1] - cfg.SEG[0] + 1));
      for (var t = 1; t <= total; t++) {
        if (segLeft <= 0) {                      // new drift regime
          var base = lerp(cfg.MU[0], cfg.MU[1], r());
          var j0 = Math.max(0, t - 1 - cfg.MRW);
          var recent = p[t - 1] / p[j0] - 1;     // fade whatever just ran
          mu = base - cfg.MR * recent;
          segLeft = cfg.SEG[0] + Math.floor(r() * (cfg.SEG[1] - cfg.SEG[0] + 1));
        }
        var z = normal(r);
        var pr = p[t - 1] * Math.exp((mu - 0.5 * sig * sig) + sig * z);
        rets.push(pr / p[t - 1] - 1);
        p.push(pr);
        segLeft--;
      }
      assets.push({ name: cfg.NAMES[i], sig: sig, price: p, rets: rets });
    }
    return assets;
  }

  /* trailing sample covariance (lightly shrunk toward its diagonal for
     stability on short windows) — a standard risk-parity input */
  function trailingCov(assets, idx, lb) {
    var n = assets.length, start = Math.max(1, idx - lb + 1), T = idx - start + 1;
    if (T < 2) return null;
    var mean = new Array(n), i, j, k;
    for (i = 0; i < n; i++) {
      var m = 0;
      for (k = start; k <= idx; k++) m += assets[i].rets[k];
      mean[i] = m / T;
    }
    var S = [];
    for (i = 0; i < n; i++) S.push(new Array(n).fill(0));
    for (i = 0; i < n; i++)
      for (j = i; j < n; j++) {
        var c = 0;
        for (k = start; k <= idx; k++) c += (assets[i].rets[k] - mean[i]) * (assets[j].rets[k] - mean[j]);
        c /= (T - 1);
        S[i][j] = S[j][i] = c;
      }
    var shrink = 0.1;                          // pull correlations toward 0 a touch
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (i !== j) S[i][j] *= (1 - shrink);
    return S;
  }

  /* long-only equal-risk-contribution weights (cyclical coordinate descent,
     inverse-vol warm start, equal risk budget) */
  function ercWeights(S) {
    var n = S.length, i, j, sweep;
    var diag = new Array(n), x = new Array(n), sum = 0;
    for (i = 0; i < n; i++) { diag[i] = Math.max(S[i][i], 1e-18); x[i] = 1 / Math.sqrt(diag[i]); sum += x[i]; }
    for (i = 0; i < n; i++) x[i] /= sum;
    var b = 1 / n;
    for (sweep = 0; sweep < 500; sweep++) {
      var maxd = 0;
      for (i = 0; i < n; i++) {
        var a = diag[i], c = 0;
        for (j = 0; j < n; j++) if (j !== i) c += S[i][j] * x[j];
        var xi = (-c + Math.sqrt(c * c + 4 * a * b)) / (2 * a);
        var d = Math.abs(xi - x[i]); if (d > maxd) maxd = d;
        x[i] = xi;
      }
      if (maxd < 1e-12) break;
    }
    var s = 0; for (i = 0; i < n; i++) s += x[i];
    if (s <= 1e-12) { for (i = 0; i < n; i++) x[i] = 1 / n; return x; }
    for (i = 0; i < n; i++) x[i] /= s;
    return x;
  }

  /* a bot's target weights using ONLY information up to absolute index `idx` */
  function weights(kind, assets, idx, cfg) {
    cfg = cfg || DEF;
    var n = assets.length, i, w = new Array(n);
    if (kind === "equal") { for (i = 0; i < n; i++) w[i] = 1 / n; return w; }

    if (kind === "momentum") {
      var best = 0, bestR = -Infinity;
      for (i = 0; i < n; i++) {
        var j0 = Math.max(0, idx - cfg.MOM_LB);
        var rr = assets[i].price[idx] / assets[i].price[j0] - 1;
        if (rr > bestR) { bestR = rr; best = i; }
      }
      for (i = 0; i < n; i++) w[i] = i === best ? 1 : 0;
      return w;
    }

    /* risk parity — equal risk contribution on the trailing covariance,
       so it accounts for correlations between assets, not just their vols */
    var cov = trailingCov(assets, idx, cfg.VOL_LB);
    if (!cov) { for (i = 0; i < n; i++) w[i] = 1 / n; return w; }
    return ercWeights(cov);
  }

  function maxDD(V) {
    var peak = V[0], dd = 0;
    for (var i = 1; i < V.length; i++) {
      if (V[i] > peak) peak = V[i];
      var d = V[i] / peak - 1;
      if (d < dd) dd = d;
    }
    return dd;
  }

  /* full run of a bot (used by the harness; the live game steps manually) */
  function simulateBot(kind, assets, cfg) {
    cfg = cfg || DEF;
    var V = [cfg.START], W = [], cur = null;
    for (var t = 1; t <= cfg.GAME; t++) {
      var abs = cfg.WARMUP + t;
      if ((t - 1) % cfg.REBAL === 0) cur = weights(kind, assets, abs - 1, cfg);
      var pr = 0;
      for (var i = 0; i < assets.length; i++) pr += cur[i] * assets[i].rets[abs];
      V.push(V[V.length - 1] * (1 + pr));
      W.push(cur.slice());
    }
    return { V: V, W: W, dd: maxDD(V), final: V[V.length - 1] };
  }

  var api = {
    DEF: DEF, rng: rng, buildMarket: buildMarket,
    weights: weights, maxDD: maxDD, simulateBot: simulateBot
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.OptSightSim = api;
})(typeof window !== "undefined" ? window : this);
