/**
 * 万能统计脚本（免注册）：任何网站粘贴即可自动按域名统计。
 * 规则：页面停留 ≥3 秒才计 PV/UV/IP（不足 3 秒的浏览不计）。
 * 用法：<script async src="https://你的统计域名/u.js"></script>
 */
(function () {
  "use strict";
  if (window.__twULoaded) return;
  window.__twULoaded = true;

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf("/u.js") !== -1) return all[i];
      }
      return null;
    })();
  if (!script) return;

  var endpoint = script.src.replace(/\/u\.js.*$/, "") + "/api/u";
  var DWELL_MS = 3000; // 停留判定：低于此值不计

  function vid() {
    try {
      var k = "__tw_vid";
      var v = localStorage.getItem(k);
      if (!v) {
        v =
          Date.now().toString(36) +
          "-" +
          Math.random().toString(36).slice(2, 10) +
          "-" +
          Math.random().toString(36).slice(2, 10);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return "anon-" + Math.random().toString(36).slice(2, 10);
    }
  }

  var timer = null;
  var sentPath = null;
  var current = null;
  var pathStart = 0;

  function send(path) {
    if (!path || sentPath === path) return;
    sentPath = path;
    var payload = {
      domain: location.hostname,
      path: path,
      ref: document.referrer || "",
      vid: vid(),
    };
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          endpoint,
          new Blob([JSON.stringify(payload)], { type: "application/json" })
        );
        return;
      }
    } catch (e) {}
    // GIF 兜底
    var q =
      "?domain=" + encodeURIComponent(payload.domain) +
      "&path=" + encodeURIComponent(payload.path) +
      "&ref=" + encodeURIComponent(payload.ref) +
      "&vid=" + encodeURIComponent(payload.vid);
    new Image().src = endpoint + q;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    var path = current;
    // 核心 3 秒判定：停留满 3 秒才上报；提前离开定时器被清理，该次浏览不计
    timer = setTimeout(function () {
      send(path);
    }, DWELL_MS);
  }

  function track() {
    var p = location.pathname + location.search;
    if (p === current) return;
    current = p;
    pathStart = Date.now();
    schedule();
  }

  // 卸载兜底：后台标签页定时器被节流时，停留已满 3 秒则离页前补发
  window.addEventListener("pagehide", function () {
    if (current && sentPath !== current && Date.now() - pathStart >= DWELL_MS) {
      send(current);
    }
  });

  // SPA 路由监听：快速跳转（<3s）的路径自动被下一次 track() 取消
  var push = history.pushState;
  if (push) {
    history.pushState = function () {
      push.apply(history, arguments);
      setTimeout(track, 0);
    };
    window.addEventListener("popstate", track);
  }
  window.addEventListener("hashchange", track);

  track();
})();
