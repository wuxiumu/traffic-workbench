/**
 * Traffic Workbench 嵌入统计脚本
 * 用法：<script async src="https://你的统计域名/m.js" data-key="站点KEY"></script>
 * 特性：PV 上报（sendBeacon 主通道 + GIF 兜底）、SPA 路由监听、UV 匿名访客 ID
 */
(function () {
  "use strict";
  if (window.__twLoaded) return;
  window.__twLoaded = true;

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf("/m.js") !== -1) return all[i];
      }
      return null;
    })();
  if (!script) return;

  var siteKey = script.getAttribute("data-key") || "";
  if (!siteKey) return;

  var endpoint = script.src.replace(/\/m\.js.*$/, "") + "/api/collect";

  // 匿名访客 ID：localStorage 持久化，无任何个人信息
  function visitorId() {
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

  function send(path) {
    var payload = {
      key: siteKey,
      path: path,
      ref: document.referrer || "",
      domain: location.hostname,
      vid: visitorId(),
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
    // 兜底：GIF 像素上报
    var q =
      "?key=" + encodeURIComponent(payload.key) +
      "&path=" + encodeURIComponent(payload.path) +
      "&ref=" + encodeURIComponent(payload.ref) +
      "&domain=" + encodeURIComponent(payload.domain) +
      "&vid=" + encodeURIComponent(payload.vid);
    new Image().src = endpoint + q;
  }

  function currentPath() {
    return location.pathname + location.search;
  }

  var lastPath = null;
  function track() {
    var p = currentPath();
    if (p === lastPath) return; // 同路径去重（如 hash 变化重复触发）
    lastPath = p;
    send(p);
  }

  // SPA 路由监听（history API + hash 路由）
  var push = history.pushState;
  if (push) {
    history.pushState = function () {
      push.apply(history, arguments);
      setTimeout(track, 0);
    };
    window.addEventListener("popstate", track);
  }
  window.addEventListener("hashchange", track);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", track);
  } else {
    track();
  }
})();
