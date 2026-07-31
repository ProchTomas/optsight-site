/* OptSight landing — tiny, dependency-free interactions.
   Everything here is progressive enhancement: with JS disabled the page is
   fully readable and all content is visible (see the reduced-motion CSS). */
(function () {
  "use strict";

  /* ---- current year in footer ---- */
  var yr = document.querySelector("[data-year]");
  if (yr) yr.textContent = String(new Date().getFullYear());

  /* ---- sticky nav background after scroll ---- */
  var nav = document.getElementById("nav");
  function onScroll() {
    if (!nav) return;
    nav.classList.toggle("is-scrolled", window.scrollY > 12);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- scroll reveal (one-shot) ---- */
  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var items = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  if (reduce || !("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var el = entry.target;
          // gentle stagger for siblings in the same grid
          var sibs = Array.prototype.slice.call(el.parentNode.children)
            .filter(function (n) { return n.classList.contains("reveal"); });
          var i = sibs.indexOf(el);
          el.style.transitionDelay = Math.min(i, 6) * 70 + "ms";
          el.classList.add("is-visible");
          io.unobserve(el);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---- hero terminal: type the boot command on load ---- */
  var typed = document.querySelector(".typed");
  if (typed) {
    var text = typed.getAttribute("data-text") || "";
    if (reduce) {
      typed.textContent = text;
    } else {
      var i = 0;
      var step = function () {
        typed.textContent = text.slice(0, i);
        if (i++ < text.length) setTimeout(step, 55);
      };
      setTimeout(step, 450); // brief pause, like a prompt waking up
    }
  }

  /* ---- placeholder CTA feedback ----
     Buy/Download aren't wired to a checkout or installer yet. Until they are,
     unwired links surface a toast instead of silently doing nothing. Wire-up:
       - Buy:      set the pricing-card link's href to your checkout URL.
       - Download: point data-cta="download" links at the installer URL.        */
  var toast = document.getElementById("toast");
  var toastTimer = null;
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("is-show");
    }, 3200);
  }

  document.addEventListener("click", function (e) {
    var link = e.target.closest ? e.target.closest("[data-cta]") : null;
    if (!link) return;
    var kind = link.getAttribute("data-cta");
    var href = link.getAttribute("href") || "";
    var unwired = href === "#" || href === "";

    if (kind === "download") {
      e.preventDefault();
      showToast("Download will be available at launch — purchase to get notified.");
    } else if (kind === "buy" && unwired) {
      e.preventDefault();
      showToast("Checkout is coming soon. Thanks for your interest in OptSight!");
    }
    // wired links (real href) fall through to normal navigation
  });
})();
