    /* dashboard scripts */

    const THEME_COLORS = {
      tick:   (isDark) => (isDark ? "rgba(255,255,255,0.65)" : "rgba(30,30,40,0.80)"),
      grid:   (isDark) => (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)"),
      gridNet:(isDark) => (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"),
    };

    /* the container element carries the active theme class, every chart and
       widget asks it for the current mode */
    function isDarkTheme() {
      return !document
        .getElementById("custom_status_container")
        ?.classList.contains("theme-light");
    }

    function createTooltipEl(id, cls) {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.className = cls;
        el.setAttribute("role", "tooltip");
        const box = document.getElementById("custom_status_container");
        if (box) box.appendChild(el);
        else document.body.appendChild(el);
      }
      return el;
    }

    function positionTooltip(el, chart, tooltip) {
      const canvasRect = chart.canvas.getBoundingClientRect();
      const container = document.getElementById("custom_status_container");
      const containerRect = container
        ? container.getBoundingClientRect()
        : { left: 0, top: 0 };
      const cx = tooltip.caretX != null ? tooltip.caretX : tooltip.x;
      const cy = tooltip.caretY != null ? tooltip.caretY : tooltip.y;
      el.style.left =
        canvasRect.left - containerRect.left + (cx != null ? cx : 0) + "px";
      el.style.top =
        canvasRect.top - containerRect.top + (cy != null ? cy : 0) + "px";
      el.style.opacity = "1";
      el.style.visibility = "visible";
    }

    function maskIpText(text) {
      if (!text || text === "N/A" || text === "-" || text === "") return text;
      return text.replace(/[0-9a-fA-F]/g, "*");
    }

    /* append a sample to a rolling line chart. datasetIndex is a single
       index or an array of them (the wan chart has rx and tx) and value
       follows the same shape. */
    function pushChartSample(chart, datasetIndex, value, maxLen) {
      const idxs = Array.isArray(datasetIndex) ? datasetIndex : [datasetIndex];
      const vals = Array.isArray(value) ? value : idxs.map(() => value);
      chart.data.labels.push("");
      idxs.forEach((i, n) => chart.data.datasets[i].data.push(vals[n]));
      if (chart.data.labels.length > maxLen) {
        chart.data.labels.shift();
        chart.data.datasets.forEach((d) => d.data.shift());
      }
    }

    function hideTooltip(el) {
      el.style.opacity = "0";
      el.style.visibility = "hidden";
    }

    /* a trigger button that toggles a dropdown panel, returns the handles
       so the caller can close it again */
    function setupDropdown(dropdownId, triggerId, onToggle) {
      const dropdown = document.getElementById(dropdownId);
      const trigger = document.getElementById(triggerId);
      if (!dropdown || !trigger) return null;
      const close = () => {
        dropdown.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        if (onToggle) onToggle(false);
      };
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = dropdown.classList.toggle("open");
        trigger.setAttribute("aria-expanded", String(open));
        if (onToggle) onToggle(open);
      });
      document.addEventListener("click", close);
      return { dropdown: dropdown, trigger: trigger, close: close };
    }

    /* the same thresholds drive the cpu badge and the wifi temp dot */
    function tempClass(t) {
      return t > 80 ? "hot" : t > 60 ? "warm" : "ok";
    }

    /* total jiffies of a cpu counter set */
    function cpuJiffies(c) {
      return (
        (c.usr || 0) +
        (c.nice || 0) +
        (c.sys || 0) +
        (c.idle || 0) +
        (c.iowait || 0) +
        (c.irq || 0) +
        (c.softirq || 0) +
        (c.steal || 0)
      );
    }

    /* empty state messages */
    const NO_APS_HTML = '<div class="cl_no_lan">No active APs</div>';
    const NO_PORTS_HTML =
      '<div class="cl_no_lan"><svg class="icon icon-network-wired" style="margin-right:6px;"><use href="#icon-network-wired"/></svg>No LAN ports</div>';
    const NO_WIFI_HTML =
      '<div class="cl_no_lan"><svg class="icon icon-wifi" style="margin-right:6px;"><use href="#icon-wifi"/></svg>No wireless interface</div>';

    /* vnstat reports interfaces either as plain names or as objects */
    function vnstatIfaceName(f) {
      return typeof f === "object" ? f.name : f;
    }

    function vnstatIfaceLabel(ifaces, iface) {
      const found = (ifaces || []).find((f) => vnstatIfaceName(f) === iface);
      if (!found) return iface || "";
      return typeof found === "object" ? found.label : found;
    }

    /* clock */
    (function () {
      const elTime = document.getElementById("current_time");
      const elAmpm = document.getElementById("tile_ampm");
      const elDate = document.getElementById("tile_date");
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      function updateClock() {
        const now = new Date();
        let h = now.getHours();
        const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        const hh = String(h).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const ss = String(now.getSeconds()).padStart(2, "0");
        if (elTime) elTime.textContent = hh + ":" + mm + ":" + ss;
        if (elAmpm) elAmpm.textContent = ap;
        if (elDate)
          elDate.textContent =
            days[now.getDay()] +
            ", " +
            months[now.getMonth()] +
            " " +
            now.getDate();
      }
      updateClock();
      const clockTimer = setInterval(updateClock, 1000);
    })();

    /* force refresh button */
    (function () {
      const btn = document.getElementById("force_refresh_btn");
      if (!btn) return;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await ubusCall("dashboard", "force_refresh");
          const cr = window.CustomRealtime;
          cr.prevTime = null;
          cr.prevRX = null;
          cr.prevTX = null;
          cr.prevDataTs = null;
          cr.lastCpu = null;
          cr.lastCoreCounters = {};
          await cr.update(true);
        } catch (e) {
          console.warn("Force refresh failed:", e);
        }
        setTimeout(() => {
          btn.disabled = false;
        }, 2000);
      });
    })();

    /* settings panel */
    (function () {
      const settingsBtn = document.getElementById("settings_btn");
      const settingsPanel = document.getElementById("settings_panel");
      if (!settingsBtn || !settingsPanel) return;

      const SETTINGS_OBJ = "dashboard";
      let loaded = false;

      function openPanel() {
        settingsPanel.classList.add("open");
        settingsBtn.setAttribute("aria-expanded", "true");
      }
      function closePanel() {
        settingsPanel.classList.remove("open");
        settingsBtn.setAttribute("aria-expanded", "false");
      }

      settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        settingsPanel.classList.contains("open") ? closePanel() : openPanel();
      });
      document.addEventListener("click", (e) => {
        if (!settingsPanel.contains(e.target)) closePanel();
      });
      settingsPanel.addEventListener("click", (e) => e.stopPropagation());

      // get the current state and set the toggles
      function fetchState() {
        ubusCall(SETTINGS_OBJ, "get_settings")
          .then((data) => {
            ["vnstat", "vnstat_db"].forEach((key) => {
              const el = document.getElementById("toggle_" + key);
              if (el) applyToggleState(el, data[key] !== "0");
            });
            applyDbStatus(
              data.vnstat_db !== "0",
              data.vnstat_db_active,
              data.vnstat_db_interval,
            );
          })
          .catch(() => {});
      }

      function applyDbStatus(uciOn, cronActive, cronInterval) {
        const dot = document.getElementById("vnstat_db_status_dot");
        const text = document.getElementById("vnstat_db_status_text");
        const fixBtn = document.getElementById("vnstat_db_fix_button");
        const settingsBtn = document.getElementById("settings_btn");
        if (!dot || !text) return;

        dot.className = "csp_status_dot";
        text.className = "csp_status_text";
        if (fixBtn) {
          fixBtn.className = "csp_fix_button";
        }
        if (settingsBtn) {
          settingsBtn.classList.remove("has-warning");
        }

        if (!uciOn && !cronActive) {
          dot.classList.add("inactive");
          text.classList.add("inactive");
          text.textContent = "not scheduled";
          if (fixBtn) fixBtn.classList.add("hidden");
        } else if (uciOn && cronActive) {
          dot.classList.add("active");
          text.classList.add("active");
          text.textContent = "active: " + (cronInterval || "every 12h");
          if (fixBtn) fixBtn.classList.add("hidden");
        } else if (uciOn && !cronActive) {
          // enabled in uci but no cron entry, something is off
          dot.classList.add("warn");
          text.classList.add("warn");
          text.textContent = "cron missing — click to fix or restart service";
          if (fixBtn) fixBtn.classList.remove("hidden");
          if (settingsBtn) settingsBtn.classList.add("has-warning");
        } else {
          // disabled in uci but cron is still there, leftover entry
          dot.classList.add("warn");
          text.classList.add("warn");
          text.textContent = "stale cron entry found";
          if (fixBtn) fixBtn.classList.add("hidden");
          if (settingsBtn) settingsBtn.classList.add("has-warning");
        }
      }

      function applyToggleState(el, on) {
        el.classList.toggle("on", on);
        el.setAttribute("aria-checked", String(on));
      }

      // load settings right away so the badge shows up if needed
      if (!loaded) {
        loaded = true;
        fetchState();
      }

      // toggle click
      settingsPanel.querySelectorAll(".csp_toggle").forEach((toggle) => {
        function doToggle() {
          if (toggle.classList.contains("busy")) return;
          const key = toggle.dataset.key;
          const isOn = toggle.classList.contains("on");
          const newVal = isOn ? "0" : "1";

          toggle.classList.add("busy");
          toggle.classList.add("loading");
          applyToggleState(toggle, !isOn); // optimistic

          function releaseBusy() {
            toggle.classList.remove("busy");
            toggle.classList.remove("loading");
          }

          ubusCall(SETTINGS_OBJ, "set_settings", { key: key, val: newVal })
            .then((data) => {
              if (!data.ok) { applyToggleState(toggle, isOn); releaseBusy(); return; }
              // refresh the whole state so the status dot gets updated
              if (key === "vnstat_db") fetchState();
              // ask for new data so the card shows up or goes away.
              // the collector needs a moment to notice the force refresh
              // signal, so keep retrying a few times.
              if (window.CustomRealtime && key === "vnstat") {
                const cr = window.CustomRealtime;
                cr.lastUpdate = cr.lastUpdate || {};
                let attempts = 0;
                function retryRefresh() {
                  cr.lastUpdate[key] = 0;
                  cr.update(true).catch(() => {});
                  attempts++;
                  if (attempts < 10) {
                    setTimeout(retryRefresh, 700);
                  } else {
                    releaseBusy();
                  }
                }
                setTimeout(retryRefresh, 400);
              } else {
                releaseBusy();
              }
            })
            .catch(() => { applyToggleState(toggle, isOn); releaseBusy(); });
        }

        toggle.addEventListener("click", doToggle);
        toggle.addEventListener("keydown", (e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            doToggle();
          }
        });
      });

      // fix button
      const fixBtn = document.getElementById("vnstat_db_fix_button");
      if (fixBtn) {
        fixBtn.addEventListener("click", function () {
          if (this.classList.contains("busy")) return;
          this.classList.add("busy");

          ubusCall("dashboard", "fix_cron")
            .then((data) => {
              if (data.ok) {
                // worked, update the status
                fetchState();
              } else {
                // something went wrong
                console.error("Failed to fix cron:", data.error);
                alert(
                  "Failed to add cron job: " + (data.error || "unknown error"),
                );
              }
            })
            .catch((err) => {
              console.error("Network error:", err);
              alert("Network error while trying to fix cron job");
            })
            .finally(() => {
              this.classList.remove("busy");
            });
        });
      }
    })();

    /* update check */
    (function () {
      function showUpdateToast() {
        var existing = document.getElementById("update_toast");
        if (existing) existing.remove();
        var toast = document.createElement("div");
        toast.id = "update_toast";
        toast.className = "update_toast";
        toast.innerHTML =
          '<div class="update_toast_icon"><svg class="icon icon-copy"><use href="#icon-copy"/></svg></div>' +
          '<div class="update_toast_body">' +
          '<div class="update_toast_title">Install command copied</div>' +
          '<div class="update_toast_msg">Paste it into your router\'s SSH console to upgrade.</div>' +
          '</div>' +
          '<button class="update_toast_close" type="button" aria-label="Dismiss">&times;</button>';
        document.body.appendChild(toast);
        var dismiss = function () {
          toast.classList.remove("show");
          setTimeout(function () { toast.remove(); }, 300);
        };
        toast.querySelector(".update_toast_close").addEventListener("click", dismiss);
        requestAnimationFrame(function () { toast.classList.add("show"); });
        setTimeout(dismiss, 4500);
      }
      const elCurrentVer = document.getElementById("update_current_ver");
      const elLatestVer = document.getElementById("update_latest_ver");
      const elStatusText = document.getElementById("update_status_text");
      const elCheckBtn = document.getElementById("update_check_btn");
      const elDownloadBtn = document.getElementById("update_download_btn");
      const elReleaseBtn = document.getElementById("update_release_btn");
      const elCopyBtn = document.getElementById("update_copy_btn");
      const settingsBtn = document.getElementById("settings_btn");

      function showError(msg) {
        if (elStatusText) {
          elStatusText.textContent = msg;
          elStatusText.className = "csp_update_status_text error";
        }
        if (elCheckBtn) elCheckBtn.classList.remove("busy");
      }

      function doCheck(force) {
        if (elCheckBtn) elCheckBtn.classList.add("busy");
        if (elStatusText) {
          elStatusText.textContent = "checking…";
          elStatusText.className = "csp_update_status_text";
        }

        var retries = 0;
        function poll(useForce) {
          ubusCall("dashboard", "update_check", { force: useForce ? 1 : 0 })
            .then((data) => {
              /* rpcd answers "checking" while it does the fetch in the
                 background, so keep asking until we get a result */
              if (data.error === "checking" && retries < 25) {
                retries++;
                setTimeout(() => poll(false), 2000);
                return;
              }

              if (elCurrentVer)
                elCurrentVer.textContent = data.current_version || "unknown";
              if (elLatestVer)
                elLatestVer.textContent = data.latest_version || "unknown";

              if (data.error === "checking") {
                showError("Check timed out — click to retry");
                return;
              }

              if (data.error) {
                showError(data.error);
                return;
              }

              if (data.has_update) {
                if (elStatusText) {
                  elStatusText.textContent =
                    "Update available: " + data.latest_version;
                  elStatusText.className =
                    "csp_update_status_text update-available";
                }
                if (elDownloadBtn && data.download_url) {
                  elDownloadBtn.href = data.download_url;
                  elDownloadBtn.classList.remove("hidden");
                }
                if (elReleaseBtn && data.release_url) {
                  elReleaseBtn.href = data.release_url;
                  elReleaseBtn.classList.remove("hidden");
                }
                if (elCopyBtn && data.download_url) {
                  elCopyBtn.dataset.url = data.download_url;
                  elCopyBtn.classList.remove("hidden");
                }
                if (settingsBtn) settingsBtn.classList.add("has-warning");
              } else {
                if (elStatusText) {
                  elStatusText.textContent = "Up to date";
                  elStatusText.className = "csp_update_status_text up-to-date";
                }
                if (elDownloadBtn) elDownloadBtn.classList.add("hidden");
                if (elReleaseBtn) elReleaseBtn.classList.add("hidden");
                if (elCopyBtn) elCopyBtn.classList.add("hidden");
                if (settingsBtn) settingsBtn.classList.remove("has-warning");
              }
              if (elCheckBtn) elCheckBtn.classList.remove("busy");
            })
            .catch((err) => {
              if (err && err.transient && retries < 3) {
                retries++;
                setTimeout(() => poll(false), 2000);
                return;
              }
              showError("Network error");
              if (settingsBtn) settingsBtn.classList.remove("has-warning");
            });
        }
        poll(force);
      }

      if (elCheckBtn) {
        elCheckBtn.addEventListener("click", () => doCheck(true));
      }

      if (elCopyBtn) {
        elCopyBtn.addEventListener("click", function () {
          var url = this.dataset.url || "";
          if (!url) return;
          var ext = url.split(".").pop();
          var file = "/tmp/luci-app-dashboard." + ext;
          var cmd;
          if (ext === "apk") {
            cmd =
              "apk update && \\\n" +
              'wget --no-check-certificate -O ' + file + ' "' + url + '" && \\\n' +
              "apk add --allow-untrusted " + file + " && \\\n" +
              "rm -f " + file;
          } else {
            cmd =
              "opkg update && \\\n" +
              'wget --no-check-certificate -O ' + file + ' "' + url + '" && \\\n' +
              "opkg install " + file + " && \\\n" +
              "rm -f " + file;
          }
          var self = this;
          var done = function () {
            self.classList.add("copied");
            var orig = self.innerHTML;
            self.innerHTML =
              '<svg class="icon icon-copy"><use href="#icon-copy"/></svg> Copied';
            setTimeout(function () {
              self.classList.remove("copied");
              self.innerHTML = orig;
            }, 1500);
            showUpdateToast();
          };
          var fallbackCopy = function () {
            var ta = document.createElement("textarea");
            ta.value = cmd;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); done(); } catch (_) {}
            document.body.removeChild(ta);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(cmd).then(done).catch(fallbackCopy);
          } else {
            fallbackCopy();
          }
        });
      }

      // always check on page load, do not use the cached answer
      doCheck(true);
    })();

    /* localStorage cache */
    const CACHE_KEY = "__dashboard_cache_v1";

    function savePageCache(data) {
      try {
        const snapshot = {
          ts: Date.now(),
          system_uptime_seconds: data.system_uptime_seconds,
          cpu_temp: data.cpu_temp,
          wifi_temp: data.wifi_temp,
          network: data.network,
          mem: data.mem,
          wifi: {
            total: data.wifi && data.wifi.total,
            aps: data.wifi && data.wifi.aps,
          },
          has_wifi: data.has_wifi,
          lan: data.lan,
          device: data.device,
          vnstat: data.vnstat,
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
      } catch (_) {}
    }

    // cache is only good for 20s, after that we treat it as missing
    // and show the loading screen again
    const MAX_CACHE_AGE_MS = 20000;

    function loadPageCache() {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.ts) return null;
        if (Date.now() - parsed.ts > MAX_CACHE_AGE_MS) return null;
        if (parsed.wifi && parsed.wifi.aps && !Array.isArray(parsed.wifi.aps)) {
          parsed.wifi.aps = Object.values(parsed.wifi.aps);
        }
        return parsed;
      } catch (_) {
        return null;
      }
    }

    const STALE_IDS = [
      "net_public_ip",
      "net_public_ipv6",
      "net_isp",
      "net_wan_uptime",
      "system_uptime_control",
      "cpuPercentText",
      "cpuTempBadge",
      "custom_mem",
      "mem_free_text",
      "mem_arc_pct",
      "custom_wifi_total",
      "custom_wifi_temp",
      "custom_lan_total",
      "vn_daily_total",
      "vn_monthly_total",
      "vn_daily_rx",
      "vn_daily_tx",
      "vn_monthly_rx",
      "vn_monthly_tx",
      "router_model_val",
      "wan_rx_value",
      "wan_tx_value",
    ];
    function markStale() {
      STALE_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add("stale-value");
      });
    }
    function markFresh() {
      const overlay = document.getElementById("dashboard_loading_overlay");
      if (overlay) {
        overlay.classList.add("dlo_hidden");
        // take the overlay out of the dom after the fade so it does not
        // block clicks later
        const onDone = () => {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };
        overlay.addEventListener("transitionend", onDone, { once: true });
        // in case transitionend never fires
        setTimeout(onDone, 500);
      }
      STALE_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.classList.remove("stale-value");
          el.classList.add("freshened");
          setTimeout(() => el.classList.remove("freshened"), 600);
        }
      });
    }

    /* cpu chart tooltip is a div, not the canvas one, so the swatch and the
       label can sit on the same line */
    function cpuChartExternalTooltip(context) {
      const chart = context.chart;
      const tooltip = context.tooltip;
      const el = createTooltipEl("cpu_chart_tooltip_el", "cpu_chart_tooltip");
      if (!chart || !tooltip || tooltip.opacity === 0) {
        hideTooltip(el);
        return;
      }

      const cr = window.CustomRealtime;
      const esc =
        cr && typeof cr.escapeHtml === "function"
          ? cr.escapeHtml.bind(cr)
          : (s) => String(s);
      const body = tooltip.body;
      const labelColors = tooltip.labelColors;
      let html = "";
      if (body && body.length) {
        for (let i = 0; i < body.length; i++) {
          const lines = body[i].lines;
          const text = Array.isArray(lines)
            ? lines.join("")
            : String(lines || "");
          const lc = labelColors && labelColors[i];
          const bg =
            lc && lc.backgroundColor != null
              ? lc.backgroundColor
              : "rgba(128,128,128,0.9)";
          const bd =
            lc && lc.borderColor != null
              ? lc.borderColor
              : "rgba(255,255,255,0.25)";
          html +=
            '<div class="cpu_chart_tooltip_row">' +
            '<span class="cpu_chart_tooltip_sw" style="background:' +
            String(bg) +
            ";border:1px solid " +
            String(bd) +
            '"></span>' +
            '<span class="cpu_chart_tooltip_txt">' +
            esc(text) +
            "</span></div>";
        }
      }
      el.innerHTML = html;

      positionTooltip(el, chart, tooltip);
    }

    function cpuChartTooltipPlugins() {
      return { enabled: false, external: cpuChartExternalTooltip };
    }

    /* realtime data */
    window.CustomRealtime = {
      config: {
        fetchInterval: 2000,
        minDeltaGap: 350,
        wifiTempInterval: 5000,
        wifiCountsInterval: 20000,
        clientsUpdateInterval: 20000,
        vnstatUpdateInterval: 300000,
        deviceUpdateInterval: 300000,
        memInterval: 20000,
      },

      etag: null,
      lastCpu: null,
      prevRX: null,
      prevTX: null,
      prevTime: null,
      prevDataTs: null,
      _updating: false,
      _pollQueued: false,
      _pollTimer: null,
      _bypassMinDelta: false,
      _firstFetchDone: false,
      _firstDeltaReady: false,
      _consecutiveErrors: 0,
      _lastErrorTime: 0,
      _errorLogged: false,

      lastUpdate: {
        wifiTemp: 0,
        wifiCounts: 0,
        clients: 0,
        vnstat: 0,
        mem: 0,
        device: 0,
      },
      memSparkHistory: [],
      elements: {},

      cpuHistory: [],
      rxHistory: [],
      txHistory: [],
      coreHistories: [],
      lastCoreCounters: {},

      wanUnit: (() => {
        try {
          const saved = localStorage.getItem("__dashboard_wan_unit");
          return saved === "Mbps" ? "Mbps" : "MBs";
        } catch (_) { return "MBs"; }
      })(),
      vnstatIface: (() => {
        try { return localStorage.getItem("__dashboard_vnstat_iface") || null; }
        catch (_) { return null; }
      })(),
      _hasWifi: null,

      applyWifiModuleState(hasWifi) {
        const tile = document.getElementById("wifi_tile");
        const head = document.getElementById("wifi_tile_head");
        const apList = document.getElementById("custom_wifi_ap_list");
        const tempFoot = document.getElementById("wifi_temp_foot");
        const noWifi = document.getElementById("no_wifi_module");
        const badge = document.getElementById("custom_wifi_total");
        if (hasWifi === false) {
          if (tile) tile.classList.add("cl_tile--no-wifi");
          if (head) head.style.display = "none";
          if (apList) apList.style.display = "none";
          if (tempFoot) tempFoot.style.display = "none";
          if (noWifi) noWifi.style.display = "";
          if (badge) badge.style.display = "none";
        } else {
          if (tile) tile.classList.remove("cl_tile--no-wifi");
          if (head) head.style.display = "";
          if (apList) apList.style.display = "";
          if (tempFoot) tempFoot.style.display = "";
          if (noWifi) noWifi.style.display = "none";
          if (badge) badge.style.display = "";
        }
      },

      getMemArcColor(pct) {
        return pct < 70 ? "#26c6da" : pct < 87 ? "#b07d10" : "#b33329";
      },
      normalizeMemInfo(mem) {
        const total = Number(mem && mem.total) || 0;
        const avail = Math.max(0, Number(mem && mem.avail) || 0);
        const physicalTotal = Number(mem && mem.physical_total) || 0;
        const denominator = Math.max(total, physicalTotal);
        const used = Math.max(0, denominator - avail);
        const pct = denominator > 0 ? Math.min(100, (used / denominator) * 100) : 0;
        return { total, avail, physicalTotal, denominator, used, pct };
      },
      formatMemKb(kb) {
        const mb = Math.max(0, Number(kb) || 0) / 1024;
        return mb > 1024 ? (mb / 1024).toFixed(2) + " GB" : mb.toFixed(1) + " MB";
      },
      getTempBadgeClass(t) {
        return "temp_badge_" + tempClass(t);
      },
      renderDeviceWidget(device) {
        const el = this.elements;
        if (!el.router_model_val) return;
        const model =
          device && device.model != null
            ? String(device.model).trim()
            : "";
        el.router_model_val.textContent = model || "Unknown";
        el.router_model_val.title = model || "";
      },
      lastVnstatData: null,
      _lastVnstatIfaceList: null,

      buildApRow(ap, withSignal) {
        const count = Number(ap.count || 0);
        let bandCls = "cl_band cl_band_24g", bandTxt = "2.4 GHz";
        if (ap.band === "5_Ghz") { bandCls = "cl_band cl_band_5g"; bandTxt = "5 GHz"; }
        else if (ap.band === "6_Ghz") { bandCls = "cl_band cl_band_6g"; bandTxt = "6 GHz"; }

        let sigHtml = "";
        if (withSignal) {
          const q = ap.quality != null ? Number(ap.quality) : null;
          const sigTitle = q != null ? `Signal: ${q}%` : "Signal: N/A";
          const isLight = !isDarkTheme();
          const dim = isLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.18)";
          let col, a1col, a2col;
          if (q == null || q < 1) { col = dim; a1col = dim; a2col = dim; }
          else if (q < 40) { col = "#e53935"; a1col = dim; a2col = dim; }
          else if (q < 70) { col = "#fb8c00"; a1col = "#fb8c00"; a2col = dim; }
          else { col = "#43a047"; a1col = "#43a047"; a2col = "#43a047"; }
          sigHtml =
            `<svg aria-hidden="true" class="cl_signal" viewBox="0 0 16 16" width="14" height="14" title="${sigTitle}">` +
            `<circle cx="8" cy="13" r="1.2" fill="${col}"/>` +
            `<path d="M4 10 Q8 6.5 12 10" stroke="${a1col}" stroke-width="1.3" stroke-linecap="round" fill="none"/>` +
            `<path d="M1 7 Q8 2 15 7" stroke="${a2col}" stroke-width="1.3" stroke-linecap="round" fill="none"/>` +
            `</svg>`;
        }

        const row = document.createElement("div");
        row.className = "cl_ap_row" + (count === 0 ? " wifi_ap_faded" : "");
        row.innerHTML =
          `<span class="${bandCls}">${bandTxt}</span>` +
          `<span class="ap_name">${this.escapeHtml(ap.essid)}</span>` +
          `<span class="ap_sig_count">${sigHtml}<span class="ap_count">${count}</span></span>`;
        return row;
      },

      /* fill a list container with rows, or a message when it is empty */
      renderList(container, rows, emptyHtml) {
        if (!container) return;
        container.innerHTML = "";
        if (!rows || !rows.length) {
          container.innerHTML = emptyHtml;
          return;
        }
        const frag = document.createDocumentFragment();
        rows.forEach((r) => frag.appendChild(r));
        container.appendChild(frag);
      },

      /* the memory arc and the used/free numbers, shared by the cached and
         the live render path */
      renderMemStats(memInfo) {
        const el = this.elements;
        const memPct = memInfo.pct;
        if (el.mem_arc_fill) {
          el.mem_arc_fill.style.strokeDashoffset = (
            113 *
            (1 - memPct / 100)
          ).toFixed(2);
          el.mem_arc_fill.style.stroke = this.getMemArcColor(memPct);
        }
        if (el.mem_arc_pct)
          el.mem_arc_pct.textContent = memPct.toFixed(1) + "%";
        if (el.custom_mem)
          el.custom_mem.textContent = this.formatMemKb(memInfo.used);
        if (el.mem_free_text)
          el.mem_free_text.textContent = this.formatMemKb(memInfo.avail);
      },

      applyClientMonitorButton(cm) {
        const wrap = document.querySelector(".wan_client_btn_wrap");
        if (!wrap) return;

        // the client monitor is an optional package, the button only
        // shows up when it is installed
        const installed = !!(cm && cm.installed === true);

        wrap.style.display = installed ? "" : "none";

        const chart = document.querySelector(".wan_merged_chart");
        if (chart) {
          // no button, let the chart use the extra space
          chart.classList.toggle("wan-chart-expanded", !installed);
          // the chart size changed, so tell chart.js about it
          if (typeof netChart !== "undefined" && netChart) {
            netChart.resize();
          }
        }
      },

      applyCachedData(cached) {
        if (!cached) return;
        const el = this.elements;

        if (cached.client_monitor !== undefined) {
          this.applyClientMonitorButton(cached.client_monitor);
        }

        if (el.system_uptime_control && cached.system_uptime_seconds != null)
          el.system_uptime_control.textContent = this.formatUptimeFlex(
            Number(cached.system_uptime_seconds),
          );

        if (cached.network) this.applyNetworkFields(cached.network, true);

        if (el.cpuTempBadge && cached.cpu_temp != null) {
          const t = Number(cached.cpu_temp) || 0;
          el.cpuTempBadge.textContent = Math.round(t) + " °C";
          el.cpuTempBadge.className = "temp_badge " + this.getTempBadgeClass(t);
        }
        if (cached.mem) {
          const memInfo = this.normalizeMemInfo(cached.mem);
          this.renderMemStats(memInfo);
          if (this.memSparkHistory.length === 0) {
            for (let i = 0; i < 20; i++)
              this.memSparkHistory.push(memInfo.pct);
            this.drawSparkline();
          }
        }

        if (cached.wifi && el.custom_wifi_total)
          el.custom_wifi_total.textContent = cached.wifi.total || 0;

        if (cached.has_wifi != null && this._hasWifi === null) {
          this._hasWifi = cached.has_wifi;
          this.applyWifiModuleState(this._hasWifi);
        }

        if (cached.wifi && Array.isArray(cached.wifi.aps)) {
          const rows = cached.wifi.aps.map((ap) => this.buildApRow(ap, false));
          this.renderList(
            document.getElementById("custom_wifi_ap_list"),
            rows,
            NO_APS_HTML,
          );
        }

        if (cached.wifi_temp != null && el.custom_wifi_temp)
          el.custom_wifi_temp.textContent =
            Math.round(Number(cached.wifi_temp) || 0) + " °C";
        else if (cached.wifi_temp == null && el.custom_wifi_temp)
          el.custom_wifi_temp.textContent = "N/A";

        if (cached.lan && el.custom_lan_total)
          el.custom_lan_total.textContent = cached.lan.total || 0;

        if (cached.device) {
          this.renderDeviceWidget(cached.device);
        }

        if (cached.vnstat) {
          const vnstatCard = document.getElementById("vnstat_card");
          const clientsCard = document.querySelector(".status_card.clients");
          if (cached.vnstat.disabled === true) {
            if (vnstatCard) vnstatCard.style.display = "none";
            if (clientsCard) clientsCard.classList.add("clients--expanded");
          } else {
            if (vnstatCard) vnstatCard.style.display = "";
            if (clientsCard) clientsCard.classList.remove("clients--expanded");
            this.lastVnstatData = cached.vnstat;
            this.renderVnstatData(cached.vnstat);
          }
        }
      },

      computeCoreUsage(currCores) {
        const ordered = Object.keys(currCores)
          .sort(
            (a, b) =>
              Number(a.replace(/^\D+/, "")) - Number(b.replace(/^\D+/, "")),
          )
          .map((k) => ({
            name: k,
            curr: currCores[k],
            prev: this.lastCoreCounters[k],
          }));

        const hasprev = ordered.some(({ prev }) => !!prev);
        this.lastCoreCounters = {};
        ordered.forEach(({ name, curr }) => {
          this.lastCoreCounters[name] = curr;
        });
        if (!hasprev) return null;

        return ordered.map(({ curr, prev }) => {
          if (!prev) return 0;
          const pT = cpuJiffies(prev);
          const cT = cpuJiffies(curr);
          const dT = cT - pT,
            dI = curr.idle - prev.idle;
          return dT > 0 ? ((dT - dI) / dT) * 100 : 0;
        });
      },

      _showVnstatWarning(warnEl, contentEl, dropdown, menu, trigger, labelEl, cls, html) {
        if (menu) menu.innerHTML = "";
        if (labelEl) labelEl.textContent = "";
        if (dropdown) {
          dropdown.style.display = "none";
          dropdown.classList.remove("open");
        }
        if (trigger) trigger.setAttribute("aria-expanded", "false");
        if (warnEl) {
          warnEl.className = "vnstat_warn " + cls;
          warnEl.innerHTML = html;
          warnEl.style.display = "flex";
        }
        if (contentEl) contentEl.style.display = "none";
      },

      renderVnstatData(vnstat) {
        const warnEl = document.getElementById("vnstat_warning");
        const contentEl = document.getElementById("vnstat_content");
        const el = this.elements;
        if (!vnstat) return;

        const dropdown = document.getElementById("vn_iface_dropdown");
        const menu = document.getElementById("vn_iface_menu");
        const trigger = document.getElementById("vn_iface_trigger");
        const labelEl = document.getElementById("vn_iface_label");

        const installed = vnstat.installed !== false;
        if (!installed) {
          this._showVnstatWarning(
            warnEl, contentEl, dropdown, menu, trigger, labelEl,
            "warn--missing",
            '<svg class="icon icon-circle-xmark"><use href="#icon-circle-xmark"/></svg><span>vnStat is not installed. Bandwidth usage data is unavailable.</span>',
          );
          return;
        }

        const ifaces = Array.isArray(vnstat.ifaces) ? vnstat.ifaces : [];
        const ifaceNames = ifaces.map(vnstatIfaceName);

        const vnstatDbEmptyHtml =
          '<svg class="icon icon-database"><use href="#icon-database"/></svg><span><strong>No usage data available.</strong> ' +
          "The vnStat database is empty or has not recorded statistics yet. " +
          'In <a href="/cgi-bin/luci/admin/status/vnstat2/config">vnStat configuration</a>, ' +
          "confirm the desired interfaces are monitored and the vnStat service is running; " +
          "totals will appear here after traffic is collected.</span>";

        if (ifaceNames.length === 0) {
          this._showVnstatWarning(
            warnEl, contentEl, dropdown, menu, trigger, labelEl,
            "warn--empty", vnstatDbEmptyHtml,
          );
          return;
        }

        const sel =
          this.vnstatIface && ifaceNames.includes(this.vnstatIface)
            ? this.vnstatIface
            : ifaceNames[0] || null;
        const ifaceData = vnstat.data && sel ? vnstat.data[sel] || {} : {};
        const d = ifaceData.daily || {};
        const m = ifaceData.monthly || {};

        const isEmpty = (v) =>
          !v || v === "N/A" || v === "0" || v === "0 B" || v === "0.00 B";

        // check if any interface has traffic, not only the one we show
        let anyInterfaceHasData = false;
        if (vnstat.data && typeof vnstat.data === "object") {
          for (const [ifaceName, data] of Object.entries(vnstat.data)) {
            const daily = data.daily || {};
            const monthly = data.monthly || {};
            const fields = [
              daily.rx,
              daily.tx,
              daily.total,
              monthly.rx,
              monthly.tx,
              monthly.total,
            ];
            if (!fields.every(isEmpty)) {
              anyInterfaceHasData = true;
              break;
            }
          }
        }

        if (!anyInterfaceHasData) {
          this._showVnstatWarning(
            warnEl, contentEl, dropdown, menu, trigger, labelEl,
            "warn--empty", vnstatDbEmptyHtml,
          );
          return;
        }

        if (warnEl) {
          warnEl.style.display = "none";
          warnEl.className = "vnstat_warn";
        }
        if (contentEl) contentEl.style.display = "";

        if (dropdown) {
          dropdown.style.display = "";
          dropdown.classList.remove("open");
          if (trigger) trigger.setAttribute("aria-expanded", "false");
        }

        if (el.vn_daily_rx) el.vn_daily_rx.textContent = d.rx || "N/A";
        if (el.vn_daily_tx) el.vn_daily_tx.textContent = d.tx || "N/A";
        if (el.vn_daily_total) el.vn_daily_total.textContent = d.total || "N/A";
        if (el.vn_monthly_rx) el.vn_monthly_rx.textContent = m.rx || "N/A";
        if (el.vn_monthly_tx) el.vn_monthly_tx.textContent = m.tx || "N/A";
        if (el.vn_monthly_total)
          el.vn_monthly_total.textContent = m.total || "N/A";
        const today = new Date();
        if (el.vn_daily_header)
          el.vn_daily_header.textContent = `Today - ${today.toLocaleString([], { month: "short" })} ${today.getDate()}`;
        if (el.vn_monthly_header)
          el.vn_monthly_header.textContent = today.toLocaleString([], {
            month: "long",
          });
      },

      cacheElements() {
        [
          "net_status",
          "net_public_ip",
          "net_public_ipv6",
          "ipv6_block",
          "net_isp",
          "net_wan_uptime",
          "net_wan_uptime_label",
          "custom_mem",
          "mem_arc_fill",
          "mem_arc_pct",
          "custom_wifi_total",
          "custom_wifi_temp",
          "wifi_temp_dot",
          "wifi_temp_foot",
          "custom_lan_total",
          "custom_lan_ports",
          "custom_lan_port_dots",
          "custom_lan_port_strip",
          "vn_daily_rx",
          "vn_daily_tx",
          "vn_daily_total",
          "vn_monthly_rx",
          "vn_monthly_tx",
          "vn_monthly_total",
          "vn_daily_header",
          "vn_monthly_header",
          "cpuPercentText",
          "cpuBarFill",
          "cpuTempBadge",
          "cpuAvgText",
          "cpuMaxText",
          "wan_rx_value",
          "wan_tx_value",
          "wan_rx_avg",
          "wan_rx_max",
          "wan_tx_avg",
          "wan_tx_max",
        ].forEach((id) => {
          this.elements[id] = document.getElementById(id);
        });

        this.elements.system_uptime_control = document.getElementById(
          "system_uptime_control",
        );
        this.elements.router_model_val =
          document.getElementById("router_model_val");
        this.elements.mem_free_text = document.getElementById("mem_free_text");
        this.elements.mem_sparkline = document.getElementById("mem_sparkline");
        this.elements.mem_spark_tooltip =
          document.getElementById("mem_spark_tooltip");
        this.elements.wan_uptime_row =
          document.getElementById("wan_uptime_row");
        this.elements.wan_down_msg = document.getElementById("wan_down_msg");

        const sparkCanvas = this.elements.mem_sparkline;
        const sparkTooltip = this.elements.mem_spark_tooltip;
        if (sparkCanvas && sparkTooltip) {
          sparkCanvas.addEventListener("mousemove", (e) => {
            const pts = this.memSparkHistory;
            if (!pts.length) return;
            const rect = sparkCanvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const idx = Math.round((mx / rect.width) * (pts.length - 1));
            const clamped = Math.max(0, Math.min(pts.length - 1, idx));
            sparkTooltip.textContent = pts[clamped].toFixed(1) + "%";
            sparkTooltip.style.display = "block";
            const hw = sparkTooltip.offsetWidth / 2;
            const clampedX = Math.max(hw, Math.min(rect.width - hw, mx));
            sparkTooltip.style.left = clampedX + "px";
            this._sparkHoverIdx = clamped;
            this.drawSparkline(clamped);
          });
          sparkCanvas.addEventListener("mouseleave", () => {
            sparkTooltip.style.display = "none";
            this._sparkHoverIdx = null;
            this.drawSparkline();
          });

          if (typeof ResizeObserver !== "undefined") {
            new ResizeObserver(() => {
              this.drawSparkline(
                this._sparkHoverIdx != null ? this._sparkHoverIdx : null,
              );
            }).observe(sparkCanvas);
          }
        }
      },

      drawSparkline(hoverIdx = null) {
        const canvas = this.elements.mem_sparkline;
        if (!canvas || !canvas.getContext) return;
        const pts = this.memSparkHistory;
        if (pts.length < 2) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.offsetWidth || 80;
        const h = canvas.offsetHeight || 28;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const padT = 3,
          padB = 3;
        const coords = pts.map((v, i) => [
          (i / (pts.length - 1)) * w,
          padT + (1 - Math.min(100, Math.max(0, v)) / 100) * (h - padT - padB),
        ]);

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "rgba(38,198,218,0.28)");
        grad.addColorStop(1, "rgba(38,198,218,0)");
        ctx.beginPath();
        ctx.moveTo(coords[0][0], h);
        coords.forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.lineTo(coords[coords.length - 1][0], h);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        coords.forEach(([x, y], i) =>
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
        );
        ctx.strokeStyle = "#26c6da";
        ctx.lineWidth = 1;
        ctx.stroke();

        if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < coords.length) {
          const [hx, hy] = coords[hoverIdx];
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(hx, 0);
          ctx.lineTo(hx, h);
          ctx.strokeStyle = "rgba(38,198,218,0.40)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.restore();
          ctx.beginPath();
          ctx.arc(hx, hy, 3, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(hx, hy, 2, 0, Math.PI * 2);
          ctx.fillStyle = "#26c6da";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(hx, hy, 2, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255,255,255,0.90)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      },

      refreshWanRates() {
        const rxH = this.rxHistory,
          txH = this.txHistory;
        if (!rxH.length) return;
        const last = rxH.length - 1;
        const rxAvg = rxH.reduce((a, b) => a + b, 0) / rxH.length;
        const txAvg = txH.reduce((a, b) => a + b, 0) / txH.length;
        const el = this.elements;
        if (el.wan_rx_value)
          el.wan_rx_value.textContent = this.formatWanRate(rxH[last]);
        if (el.wan_tx_value)
          el.wan_tx_value.textContent = this.formatWanRate(txH[last]);
        if (el.wan_rx_avg)
          el.wan_rx_avg.textContent = this.formatWanRate(rxAvg);
        if (el.wan_rx_max)
          el.wan_rx_max.textContent = this.formatWanRate(
            rxH.reduce((a, b) => Math.max(a, b), 0),
          );
        if (el.wan_tx_avg)
          el.wan_tx_avg.textContent = this.formatWanRate(txAvg);
        if (el.wan_tx_max)
          el.wan_tx_max.textContent = this.formatWanRate(
            txH.reduce((a, b) => Math.max(a, b), 0),
          );
      },

      pushPingSample(pingMs) {
        if (!ensurePingChart()) return;
        const ch = pingChart;
        pushChartSample(
          ch, 0,
          pingMs != null && isFinite(pingMs) ? Number(pingMs) : null,
          60,
        );
        const nums = ch.data.datasets[0].data.filter(
          (v) => v != null && isFinite(v),
        );
        const peak = nums.length ? Math.max(...nums) : 0;
        ch.options.scales.y.max = pingChartYAxisMax(peak);
        dashLineChartLiveUpdate(ch);
      },

      async fetchData() {
        // get_data just returns whatever the daemon has collected, it has
        // no force flag. For a forced refresh we call force_refresh
        // separately, that one makes the daemon drop its cache.
        return ubusCall("dashboard", "get_data").then(function(data) {
          if (data && data.error === "collecting") {
            return { __collecting: true, retry_ms: data.retry_ms || 500 };
          }
          if (data && data.error) {
            console.error("rpcd error:", data.error);
            throw new Error("rpcd: " + data.error);
          }
          return data;
        });
      },

      formatWanRate(bps) {
        if (!isFinite(bps) || bps < 0) bps = 0;
        if (this.wanUnit === "Mbps") {
          const mbps = (bps * 8) / 1e6;
          if (mbps >= 1000) return (mbps / 1000).toFixed(2) + " Gbps";
          if (mbps >= 1) return mbps.toFixed(2) + " Mbps";
          return ((bps * 8) / 1e3).toFixed(1) + " Kbps";
        }
        if (bps >= 1073741824) return (bps / 1073741824).toFixed(2) + " GB/s";
        if (bps >= 1048576) return (bps / 1048576).toFixed(2) + " MB/s";
        if (bps >= 1024) return (bps / 1024).toFixed(1) + " KB/s";
        return bps.toFixed(0) + " B/s";
      },

      escapeHtml(s) {
        return String(s).replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c],
        );
      },

      formatUptimeFlex(u) {
        if (u == null) return "N/A";
        if (typeof u === "string" && isNaN(Number(u.trim()))) return u;
        const s = Math.max(0, Math.floor(Number(u) || 0));
        const d = Math.floor(s / 86400),
          h = Math.floor((s % 86400) / 3600),
          m = Math.floor((s % 3600) / 60);
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m`;
        return s === 0 ? "0s" : `${s}s`;
      },

      normalizeIspName(raw) {
        if (!raw) return { isp: "N/A", asn: "" };
        let s = String(raw).trim();
        if (s.startsWith("{")) {
          try {
            const o = JSON.parse(s);
            s = o.org || o.provider || o.carrier || o.isp || "N/A";
          } catch (_) {
            s = s.replace(/^[{]+|[}]+$/g, "").trim();
          }
        }
        s = s.replace(/^"+|"+$/g, "").trim();
        const m = s.match(/AS\s*?(\d+)/i);
        let asn = "";
        if (m) {
          asn = "AS" + m[1];
          s = s.replace(m[0], "").trim();
        }
        if (!s)
          s =
            String(raw)
              .replace(/^[{"]+|[}"]+$/g, "")
              .trim() || "N/A";
        return { isp: s || "N/A", asn };
      },

      makeAsnLink(raw) {
        if (!raw) return "";
        let a = String(raw).trim();
        if (!a || a.toUpperCase() === "N/A") return "";
        if (!/^AS/i.test(a)) a = "AS" + a;
        const num = a.toUpperCase();
        return `<a class="isp_asn" href="https://ipinfo.io/${encodeURIComponent(num)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(num)}</a>`;
      },

      /* write an ip into its slot, the real value is kept in a dataset
         attribute for the eye button and masked while it is hidden */
      applyIpValue(el, eyeBtnId, text) {
        if (!el) return;
        if (text) el.dataset.original = text;
        const btn = document.getElementById(eyeBtnId);
        const masked = btn && btn.classList.contains("ip-eye-btn--masked");
        el.textContent = masked ? maskIpText(text) : text;
      },

      applyNetworkFields(net, initial = false) {
        if (!net || !this.elements.net_status) return;
        const el = this.elements;
        const status =
          typeof net.status === "string" ? net.status.trim().toLowerCase() : "";

        const prevStatus = this._lastNetStatus || "";
        const statusChanged = prevStatus !== status;

        if (status === "online" || status === "up") {
          if (statusChanged) {
            el.net_status.className = "badge online";
            el.net_status.innerHTML =
              '<span class="status-dot dot-online"></span><span>Online<span class="badge-rtt" style="opacity:0.92;font-weight:400;margin-left:5px;font-size:0.91em;"></span></span>';
          }
          const rttEl = el.net_status.querySelector(".badge-rtt");
          if (rttEl) {
            rttEl.textContent =
              net.ping_rtt_ms != null && isFinite(net.ping_rtt_ms)
                ? Number(net.ping_rtt_ms).toFixed(1) + " ms"
                : "";
          }
        } else if (status === "offline" || status === "down") {
          const secs = Number(net.downtime_seconds || 0);
          const durStr = secs > 0 ? this.formatUptimeFlex(secs) : "";
          if (statusChanged) {
            el.net_status.className = "badge offline";
            el.net_status.innerHTML =
              '<span class="status-dot dot-offline"></span>' +
              '<span class="badge-offline-stack">' +
              '<span class="badge-offline-label">Offline</span>' +
              '<span class="badge-downtime-for" style="display:none;"></span>' +
              "</span>";
          }
          const durEl = el.net_status.querySelector(".badge-downtime-for");
          if (durEl) {
            if (durStr) {
              durEl.textContent = "for " + durStr;
              durEl.style.display = "";
            } else {
              durEl.style.display = "none";
            }
          }
        } else {
          if (statusChanged) {
            el.net_status.className = "badge";
            el.net_status.innerHTML = "N/A";
          }
        }

        this._lastNetStatus = status;

        const dot = el.net_status.querySelector(".status-dot");
        if (dot && !initial && statusChanged) {
          dot.classList.remove("pulsing");
          void dot.offsetWidth;
          dot.classList.add("pulsing");
        }

        if (el.net_public_ip) {
          this.applyIpValue(
            el.net_public_ip,
            "ipv4_eye_btn",
            net.status === "offline" ? "-" : net.public_ipv4 || "N/A",
          );
        }

        if (el.ipv6_block && el.net_public_ipv6) {
          const has =
            net.public_ipv6 &&
            net.public_ipv6 !== "-" &&
            net.public_ipv6 !== "N/A";
          this.applyIpValue(
            el.net_public_ipv6,
            "ipv6_eye_btn",
            has ? net.public_ipv6 : "",
          );
          el.ipv6_block.style.display = has ? "block" : "none";
        }

        const norm = this.normalizeIspName(
          net.status === "offline" ? "-" : net.isp_name || "N/A",
        );
        const asnFinal =
          norm.asn && norm.asn !== "N/A"
            ? norm.asn
            : net.isp_asn && String(net.isp_asn).trim()
              ? String(net.isp_asn).trim()
              : "";
        if (el.net_isp) {
          const name = this.escapeHtml(norm.isp || "N/A");
          const showAsn = net.status !== "offline" && asnFinal;
          el.net_isp.innerHTML =
            `<span class="isp_name">${name}</span>` +
            (showAsn ? this.makeAsnLink(asnFinal) : "");
        }

        const wanType =
          typeof net.wan_type === "string"
            ? net.wan_type.trim().toLowerCase()
            : "";
        const wanStat =
          typeof net.wan_status === "string"
            ? net.wan_status.trim().toLowerCase()
            : "";
        const wanSecs = Number(net.wan_uptime_seconds) || 0;
        const wanDown = Number(net.wan_downtime_seconds) || 0;

        const wanUptimeEl = el.net_wan_uptime;
        const wanLabelEl = el.net_wan_uptime_label;
        const wanUpRow = el.wan_uptime_row;
        const wanDownMsg = el.wan_down_msg;

        if (wanLabelEl) {
          if (wanType === "pppoe") wanLabelEl.textContent = "PPPoE Uptime";
          else if (wanType === "dhcp") wanLabelEl.textContent = "DHCP Uptime";
          else if (wanType === "static") wanLabelEl.textContent = "WAN Uptime";
          else if (wanType !== "")
            wanLabelEl.textContent = wanType.toUpperCase() + " Uptime";
        }

        const wanStatChanged = this._lastWanStat !== wanStat;
        this._lastWanStat = wanStat;

        if (wanStat === "down") {
          if (wanUpRow) wanUpRow.style.display = "none";
          if (wanDownMsg) {
            let baseMsg;
            if (wanType === "dhcp" || wanType === "dhcpv6") {
              baseMsg = "WAN is down. No DHCP lease.";
            } else if (wanType === "static") {
              baseMsg = "WAN is down.";
            } else if (wanType !== "" && wanType !== "unknown") {
              baseMsg = wanType.toUpperCase() + " is down.";
            } else {
              baseMsg = "WAN is down.";
            }
            if (wanStatChanged) {
              wanDownMsg.innerHTML =
                '<svg class="icon icon-triangle-exclamation"><use href="#icon-triangle-exclamation"/></svg>' +
                '<span class="wan-down-base"></span>' +
                '<span class="wan-down-dur"></span>';
              wanDownMsg.style.display = "flex";
            }
            const baseEl = wanDownMsg.querySelector(".wan-down-base");
            const durEl = wanDownMsg.querySelector(".wan-down-dur");
            if (baseEl) baseEl.textContent = baseMsg;
            if (durEl)
              durEl.textContent =
                wanDown > 0 ? " for " + this.formatUptimeFlex(wanDown) : "";
          }
          if (wanUptimeEl) {
            wanUptimeEl.textContent = "Down";
            wanUptimeEl.classList.add("net-status-offline");
          }
        } else {
          if (wanUpRow) wanUpRow.style.display = "";
          if (wanDownMsg) wanDownMsg.style.display = "none";
          if (wanUptimeEl) {
            wanUptimeEl.textContent = this.formatUptimeFlex(wanSecs);
            wanUptimeEl.classList.remove(
              "net-status-offline",
              "net-status-online",
            );
            wanUptimeEl.style.color = "";
          }
        }
      },

      async update(initial = false, force = false) {
        if (this._updating) {
          this._pollQueued = true;
          return;
        }

        /* slow down the polling when rpcd is having problems, but still
           let the first and forced calls through */
        if (!initial && !force && this._consecutiveErrors > 0) {
          const backoffMs = Math.min(
            2000 * Math.pow(1.5, this._consecutiveErrors - 1),
            30000,
          );
          if (Date.now() - this._lastErrorTime < backoffMs) return;
        }

        this._updating = true;

        const now = Date.now();
        try {
          const data = await this.fetchData();

          if (data && data.__collecting) {
            setTimeout(() => this.update(false, force), data.retry_ms || 500);
            return;
          }

          if (!data) {
            throw new Error("rpcd returned no data");
          }

          if (data.wifi && data.wifi.aps && !Array.isArray(data.wifi.aps)) {
            data.wifi.aps = Object.values(data.wifi.aps);
          }

          const bypass = this._bypassMinDelta;
          if (bypass) this._bypassMinDelta = false;
          const skipDelta =
            !bypass &&
            this.prevTime !== null &&
            now - this.prevTime < this.config.minDeltaGap;

          const banner = document.getElementById("error_banner");
          if (banner) banner.style.display = "none";

          /* no error right now, so reset the error counter */
          if (this._consecutiveErrors > 0) {
            this._consecutiveErrors = 0;
            this._errorLogged = false;
            STALE_IDS.forEach((id) => {
              const el = document.getElementById(id);
              if (el) el.classList.remove("stale-value");
            });
          }

          if (!this._firstFetchDone) {
            this._firstFetchDone = true;
            savePageCache(data);
            this._lastCacheSave = Date.now();
          } else {
            if (Date.now() - (this._lastCacheSave || 0) > 30000) {
              savePageCache(data);
              this._lastCacheSave = Date.now();
            }
          }

          const pending = [];
          const el = this.elements;

          if (el.system_uptime_control)
            el.system_uptime_control.textContent = this.formatUptimeFlex(
              Number(data?.system_uptime_seconds ?? data?.system_uptime ?? 0),
            );

          // the router model never changes, so it is only redrawn once in
          // a while
          if (
            initial ||
            now - (this.lastUpdate.device || 0) >=
              this.config.deviceUpdateInterval
          ) {
            this.lastUpdate.device = now;
            if (data?.device) this.renderDeviceWidget(data.device);
          }

          // client monitor button and the wan chart width
          this.applyClientMonitorButton(data.client_monitor);

          if (data?.network) {
            this.applyNetworkFields(data.network, initial);
            const net = data.network;
            const st = (net.status || "").toString().trim().toLowerCase();
            const pingMs =
              (st === "online" || st === "up") &&
              net.ping_rtt_ms != null &&
              isFinite(Number(net.ping_rtt_ms))
                ? Number(net.ping_rtt_ms)
                : null;
            pending.push(() => this.pushPingSample(pingMs));
          }

          if (data?.cpu) {
            const c = data.cpu;
            const total = cpuJiffies(c);
            const idle = (c.idle || 0) + (c.iowait || 0);
            let cpuPercent = null;
            if (this.lastCpu && !skipDelta) {
              const dT = total - this.lastCpu.total,
                dI = idle - this.lastCpu.idle;
              if (dT > 0) cpuPercent = ((dT - dI) / dT) * 100;
            }
            this.lastCpu = { total, idle };

            if (cpuPercent !== null) {
              this._firstDeltaReady = true;
              pending.push(() => {
                if (el.cpuPercentText)
                  el.cpuPercentText.textContent = cpuPercent.toFixed(1) + "%";
                if (el.cpuBarFill) {
                  el.cpuBarFill.style.width =
                    Math.min(100, Math.max(0, cpuPercent)) + "%";
                }
                this.cpuHistory.push(cpuPercent);
                const avg =
                  this.cpuHistory.reduce((a, b) => a + b, 0) /
                  this.cpuHistory.length;
                if (el.cpuAvgText)
                  el.cpuAvgText.textContent = avg.toFixed(1) + "%";
                if (el.cpuMaxText)
                  el.cpuMaxText.textContent =
                    Math.max(...this.cpuHistory).toFixed(1) + "%";
              });

              pending.push(() => {
                pushChartSample(
                  cpuLineChart, 0,
                  parseFloat(cpuPercent.toFixed(1)),
                  60,
                );
                dashLineChartLiveUpdate(cpuLineChart);
              });
            }

            pending.push(() => {
              if (!el.cpuTempBadge) return;
              if (data.cpu_temp != null) {
                const t = Number(data.cpu_temp);
                el.cpuTempBadge.textContent = Math.round(t) + " °C";
                el.cpuTempBadge.className =
                  "temp_badge " + this.getTempBadgeClass(t);
              } else {
                el.cpuTempBadge.textContent = "N/A";
                el.cpuTempBadge.className = "temp_badge";
              }
            });

            if (initial && "cpu_multi_core" in data) {
              const chartWrap = document.querySelector(".cpu_merged_chart");
              if (chartWrap) {
                chartWrap.classList.toggle(
                  "cpu-chart--tall",
                  data.cpu_multi_core === false,
                );
                if (cpuLineChart) cpuLineChart.resize();
              }
            }

            if (data.cpu_cores && data.cpu_cores.length > 1) {
              pending.push(() => {
                const coresObj = {};
                data.cpu_cores.forEach((c) => { coresObj["cpu" + c.id] = c; });
                const usage = this.computeCoreUsage(coresObj);
                if (!usage || skipDelta) return;
                if (!cpuCoreChart) {
                  const anchor = document.querySelector(".cpu_merged_chart");
                  if (!anchor) return;
                  cpuCoreChart = createCpuCoreChart(
                    anchor,
                    isDarkTheme(),
                    true,
                  );
                }
                const colors = usage.map((v) =>
                  v <= 60
                    ? "rgba(100,180,80,0.85)"
                    : v <= 90
                      ? "rgba(255,180,40,0.85)"
                      : "rgba(220,60,60,0.85)",
                );
                if (this.coreHistories.length !== usage.length)
                  this.coreHistories = usage.map(() => []);
                usage.forEach((v, i) => this.coreHistories[i].push(v));
                cpuCoreChart._coreAvg = this.coreHistories.map(
                  (h) => h.reduce((a, b) => a + b, 0) / h.length,
                );
                cpuCoreChart._coreMax = this.coreHistories.map((h) =>
                  Math.max(...h),
                );
                cpuCoreChart.data.labels = usage.map((_, i) => "C" + (i + 1));
                cpuCoreChart.data.datasets[0].data = usage.map((v) =>
                  parseFloat(v.toFixed(1)),
                );
                cpuCoreChart.data.datasets[0].backgroundColor = colors;
                cpuCoreChart.update();
              });
            }
          }

          if (data?.net) {
            const rxNum = typeof data.net.rx === "number" ? data.net.rx : null;
            const txNum = typeof data.net.tx === "number" ? data.net.tx : null;
            const dataTs = typeof data.ts === "number" ? data.ts : null;

            if (
              !skipDelta &&
              rxNum !== null &&
              txNum !== null &&
              this.prevRX !== null &&
              this.prevTX !== null &&
              this.prevDataTs !== null &&
              dataTs !== null
            ) {
              const sec = dataTs - this.prevDataTs;
              const validDelta =
                sec > 0.1 &&
                sec <= 30 &&
                rxNum >= this.prevRX &&
                txNum >= this.prevTX;
              if (validDelta) {
                const rxRate = (rxNum - this.prevRX) / sec;
                const txRate = (txNum - this.prevTX) / sec;
                this.rxHistory.push(rxRate);
                this.txHistory.push(txRate);
                pending.push(() => {
                  if (!netChart) return;
                  pushChartSample(netChart, [0, 1], [rxRate, txRate], 60);
                  dashLineChartLiveUpdate(netChart);
                  this.refreshWanRates();
                });
              }
            }
            this.prevRX = rxNum !== null ? rxNum : this.prevRX;
            this.prevTX = txNum !== null ? txNum : this.prevTX;
            this.prevTime = now;
            if (dataTs !== null) this.prevDataTs = dataTs;
          }

          if (data?.mem) {
            const memInfo = this.normalizeMemInfo(data.mem);
            const memPct = memInfo.pct;
            if (
              initial ||
              now - (this.lastUpdate.mem || 0) >= this.config.memInterval
            ) {
              this.lastUpdate.mem = now;

              if (this.memSparkHistory.length === 0) {
                for (let i = 0; i < 20; i++)
                  this.memSparkHistory.push(memPct);
              }
              this.memSparkHistory.push(memPct);
              if (this.memSparkHistory.length > 40)
                this.memSparkHistory.shift();

              this.renderMemStats(memInfo);
              this.drawSparkline();
            }
          }

          if (data?.wifi) {
            if (this._hasWifi === null && "has_wifi" in data) {
              this._hasWifi = data.has_wifi;
              this.applyWifiModuleState(this._hasWifi);
            }

            if (
              initial ||
              now - (this.lastUpdate.wifiCounts || 0) >=
                this.config.wifiCountsInterval
            ) {
              this.lastUpdate.wifiCounts = now;

              const sortedAps = (Array.isArray(data.wifi.aps) ? data.wifi.aps : []).slice().sort((a, b) => {
                const ca = Number(a.count || 0),
                  cb = Number(b.count || 0);
                if (ca > 0 && cb === 0) return -1;
                if (ca === 0 && cb > 0) return 1;
                return 0;
              });

              const apRows = sortedAps.map((ap) => this.buildApRow(ap, true));

            pending.push(() => {
              if (el.custom_wifi_total)
                el.custom_wifi_total.textContent = data.wifi.total || 0;
              this.renderList(
                document.getElementById("custom_wifi_ap_list"),
                apRows,
                NO_APS_HTML,
              );
            });
          } else if (initial) {
            pending.push(() => {
              this.renderList(
                document.getElementById("custom_wifi_ap_list"),
                [],
                NO_WIFI_HTML,
              );
            });
          }

            if (
              initial ||
              now - (this.lastUpdate.wifiTemp || 0) >=
                this.config.wifiTempInterval
            ) {
              this.lastUpdate.wifiTemp = now;
              const hasWifiTemp = data.wifi_temp != null;
              const wifiTemp = hasWifiTemp ? Number(data.wifi_temp) || 0 : 0;
              pending.push(() => {
                if (el.custom_wifi_temp) {
                  el.custom_wifi_temp.textContent = hasWifiTemp
                    ? Math.round(wifiTemp) + " °C"
                    : "N/A";
                }
                if (el.wifi_temp_dot) {
                  el.wifi_temp_dot.className = hasWifiTemp
                    ? "cl_tdot " + tempClass(wifiTemp)
                    : "cl_tdot";
                }
                if (el.wifi_temp_foot) el.wifi_temp_foot.style.opacity = "1";
              });
            }
          }

          if (
            initial ||
            now - (this.lastUpdate.clients || 0) >=
              this.config.clientsUpdateInterval
          ) {
            this.lastUpdate.clients = now;
            if (data?.lan) {
              const ports = data.lan.ports || [];
              const total = data.lan.total || 0;

              const lanRows = ports.map((p) => {
                const row = document.createElement("div");
                row.className =
                  "cl_lan_row" + (p.active ? "" : " wifi_ap_faded");

                // bridge/ap hint, same look as the crt hint badge
                const apChip = p.ap_label
                  ? `<span class="cl_hint_badge cl_hint_badge_bridge" title="Multiple devices detected on this port — bridge, AP, or switch">⇄ Bridge / AP</span>`
                  : "";

                // link speed pill
                let speedHtml = "";
                if (p.active && p.speed) {
                  const cls =
                    p.speed >= 1000
                      ? "cl_speed cl_speed_gig"
                      : "cl_speed cl_speed_100";
                  const lbl =
                    p.speed >= 1000
                      ? p.speed / 1000 + " Gbps"
                      : p.speed + " Mbps";
                  speedHtml = `<span class="${cls}">${lbl}</span>`;
                } else if (!p.active) {
                  speedHtml = `<span class="lan_inactive">inactive</span>`;
                }

                // number of devices behind this port, only for ap/bridge
                const countBadge =
                  p.ap_label && p.mac_count >= 1
                    ? `<span class="cl_mac_count" title="${p.mac_count} device${p.mac_count !== 1 ? "s" : ""} behind this port">${p.mac_count}</span>`
                    : "";

                row.innerHTML =
                  `<span class="lan_name"><svg class="icon icon-ethernet"><use href="#icon-ethernet"/></svg>${this.escapeHtml(p.name)}</span>` +
                  apChip +
                  `<span class="cl_lan_spacer"></span>` +
                  countBadge +
                  speedHtml;
                return row;
              });

              const wanOnline = data?.network?.status === "online";
              const wanIfName = data?.net?.iface || "WAN";
              const wanDot = document.createElement("span");
              wanDot.className =
                "cl_port_dot_wan " + (wanOnline ? "wan_online" : "wan_offline");
              wanDot.title =
                wanIfName + " — " + (wanOnline ? "online" : "offline");
              wanDot.innerHTML = '<svg class="icon icon-globe"><use href="#icon-globe"/></svg>';

              const wanSep = document.createElement("span");
              wanSep.className = "cl_wan_sep";

              const dotEls = ports.map((p) => {
                const dot = document.createElement("span");
                if (!p.active) {
                  dot.className = "cl_port_dot inactive";
                  dot.title = p.name + " — inactive";
                } else if (p.speed && p.speed >= 1000) {
                  dot.className = "cl_port_dot active_gig";
                  dot.title = p.name + " — " + p.speed / 1000 + " Gbps";
                } else {
                  dot.className = "cl_port_dot active_100m";
                  dot.title = p.name + " — " + (p.speed || "?") + " Mbps";
                }
                return dot;
              });

              pending.push(() => {
                if (el.custom_lan_total)
                  el.custom_lan_total.textContent = total;
                this.renderList(el.custom_lan_ports, lanRows, NO_PORTS_HTML);
                const dotsDiv = el.custom_lan_port_dots;
                if (dotsDiv) {
                  dotsDiv.innerHTML = "";
                  const frag = document.createDocumentFragment();
                  frag.appendChild(wanDot);
                  frag.appendChild(wanSep);
                  dotEls.forEach((d) => frag.appendChild(d));
                  dotsDiv.appendChild(frag);
                  if (el.custom_lan_port_strip)
                    el.custom_lan_port_strip.style.display = "";
                }
              });
            }
          }

          const vn = data?.vnstat;
          const vnPending =
            vn &&
            vn.installed === true &&
            Array.isArray(vn.ifaces) &&
            vn.ifaces.length === 0;

          // show/hide is checked on every fetch so a toggle change is
          // picked up right away even if the details are only redrawn
          // every 5 min
          {
            const vnstatCard = document.getElementById("vnstat_card");
            const clientsCard = document.querySelector(".status_card.clients");
            if (data?.vnstat?.disabled === true) {
              if (vnstatCard) vnstatCard.style.display = "none";
              if (clientsCard) clientsCard.classList.add("clients--expanded");
            } else {
              if (vnstatCard) vnstatCard.style.display = "";
              if (clientsCard)
                clientsCard.classList.remove("clients--expanded");
            }
          }

          if (
            initial ||
            vnPending ||
            now - (this.lastUpdate.vnstat || 0) >=
              this.config.vnstatUpdateInterval
          ) {
            // only throttle when we have real data (or we know vnstat is
            // not installed), otherwise keep trying every cycle
            if (!vnPending) this.lastUpdate.vnstat = now;
            if (data?.vnstat && data?.vnstat?.disabled !== true) {
                this.lastVnstatData = data.vnstat;

                const rawIfaces = Array.isArray(data.vnstat.ifaces)
                  ? data.vnstat.ifaces
                  : [];
                const ifaceNames = rawIfaces.map(vnstatIfaceName);
                const newIfaceList = JSON.stringify(ifaceNames);

                if (newIfaceList !== this._lastVnstatIfaceList) {
                  this._lastVnstatIfaceList = newIfaceList;
                  const menu = document.getElementById("vn_iface_menu");
                  const dropdown = document.getElementById("vn_iface_dropdown");
                  const labelEl = document.getElementById("vn_iface_label");

                  if (
                    !this.vnstatIface ||
                    !ifaceNames.includes(this.vnstatIface)
                  ) {
                    this.vnstatIface = ifaceNames[0] || null;
                  }

                  if (menu) {
                    if (rawIfaces.length > 0) {
                      menu.innerHTML = rawIfaces
                        .map((f) => {
                          const nm = vnstatIfaceName(f);
                          const lbl = typeof f === "object" ? f.label : f;
                          const active = nm === this.vnstatIface;
                          return (
                            `<div class="dropdown-option${active ? " active" : ""}" ` +
                            `data-iface="${this.escapeHtml(nm)}" role="option" ` +
                            `aria-selected="${active}">${this.escapeHtml(lbl)}</div>`
                          );
                        })
                        .join("");
                      /* the click is handled by the dropdown code below */
                    } else {
                      menu.innerHTML = "";
                    }
                  }

                  if (labelEl) {
                    labelEl.textContent = vnstatIfaceLabel(
                      rawIfaces,
                      this.vnstatIface,
                    );
                  }
                  if (dropdown) {
                    if (rawIfaces.length === 0) {
                      dropdown.style.display = "none";
                      dropdown.classList.remove("open");
                    } else {
                      dropdown.style.display = "";
                    }
                  }
                }

                pending.push(() => this.renderVnstatData(data.vnstat));
            }
          }

          if (pending.length) {
            /* use setTimeout(0), requestAnimationFrame does not run in a
               background tab and some LuCI iframes report hidden wrong */
             setTimeout(() => {
               pending.forEach((fn, i) => {
                 try {
                   fn();
                 } catch (e) {
                   console.warn("pending write failed at index " + i + ":", e);
                 }
               });
             }, 0);
          }
        } catch (e) {
          this._consecutiveErrors++;
          this._lastErrorTime = Date.now();

          /* grey out the values so the user sees the data is stuck */
          if (this._consecutiveErrors >= 2) markStale();

          /* only log the first error of an outage */
          if (!this._errorLogged) {
            this._errorLogged = true;
            console.error("CustomRealtime update error:", e);
          }

          /* wait for a few failed tries before showing the banner, rpcd
             restarts on config apply are normal and should not scare the user */
          if (this._consecutiveErrors >= 3) {
            const banner = document.getElementById("error_banner");
            if (banner) {
              banner.style.display = "block";
              banner.textContent = "Realtime data unavailable";
            }
          }
        } finally {
          this._updating = false;
          const q = this._pollQueued;
          this._pollQueued = false;
          if (q)
            setTimeout(() => {
              this.update(false);
            }, 0);
        }
      },

      async start() {
        this.cacheElements();

        // put the cached values under the overlay so the page is not
        // empty, but keep the spinner up until we get fresh data
        const cached = loadPageCache();
        if (cached) {
          this.applyCachedData(cached);
          markStale();
        }

        // make the wan chart before the first update so it has somewhere
        // to put the data
        initNetChart();

        // build the per core chart right away when multi core is on
        ubusCall("dashboard", "get_settings")
          .then((s) => {
            if (s.multi_core !== "0" && !cpuCoreChart) {
              const anchor = document.querySelector(".cpu_merged_chart");
              if (anchor && !document.getElementById("cpu_core_section")) {
                cpuCoreChart = createCpuCoreChart(
                  anchor,
                  isDarkTheme(),
                  false,
                );
              }
            }
          })
          .catch(() => {});

        // first fetch only saves the baseline values, cpu% and wan speed
        // need a second one to be calculated
        try {
          await this.update(true);
        } catch (_) {}

        // remove the overlay after 8s even if the deltas never show up
        const _overlaySafety = setTimeout(() => markFresh(), 8000);

        // second fetch gives us the first real cpu% and wan speed, only
        // then we drop the overlay
        const _tryDismiss = () => {
          clearTimeout(_overlaySafety);
          if (this._firstDeltaReady) {
            markFresh();
          } else {
            setTimeout(() => {
              this._bypassMinDelta = true;
              this.update(false, true).finally(() => markFresh());
            }, 1000);
          }
        };

        setTimeout(() => {
          this._bypassMinDelta = true;
          this.update(false, true).finally(_tryDismiss);
        }, 500);

        /* setInterval on the main thread only, web workers get throttled
           when the tab is hidden and that stopped the polling completely */
        if (this._pollTimer != null) {
          try {
            clearInterval(this._pollTimer);
          } catch (_) {}
          this._pollTimer = null;
        }
        this._pollTimer = window.setInterval(() => {
          this.update(false);
        }, this.config.fetchInterval);

        let _resumeGuard = false;

        const handleResume = () => {
          if (_resumeGuard) return;
          _resumeGuard = true;
          setTimeout(() => {
            _resumeGuard = false;
          }, 600);

          this.prevTime = null;
          this.prevRX = null;
          this.prevTX = null;
          this.prevDataTs = null;
          this.lastCpu = null;
          this.lastCoreCounters = {};

          requestAnimationFrame(() => {
            if (!netChart) initNetChart();
            ensurePingChart();
          });

          this.update(false, true);
        };

        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) handleResume();
        });

        window.addEventListener("pageshow", (e) => {
          if (e.persisted) handleResume();
        });

        window.addEventListener("hashchange", () => {
          setTimeout(handleResume, 100);
        });
      },
    };

    /* chart theme */
    function applyChartTheme(isDark) {
      const tickColor = THEME_COLORS.tick(isDark);
      const gridColor = THEME_COLORS.grid(isDark);
      if (typeof cpuLineChart !== "undefined" && cpuLineChart) {
        cpuLineChart.data.datasets[0].backgroundColor = isDark
          ? "rgba(126,87,194,0.15)"
          : "rgba(126,87,194,0.20)";
        cpuLineChart.options.scales.y.grid.color = gridColor;
        cpuLineChart.options.scales.y.ticks.color = tickColor;
        cpuLineChart.update("none");
      }
      if (typeof cpuCoreChart !== "undefined" && cpuCoreChart) {
        cpuCoreChart.options.scales.y.grid.color = gridColor;
        cpuCoreChart.options.scales.y.ticks.color = tickColor;
        cpuCoreChart.update("none");
      }
      if (typeof netChart !== "undefined" && netChart) {
        netChart.options.scales.y.ticks.color = tickColor;
        netChart.options.scales.y.grid.color = THEME_COLORS.gridNet(isDark);
        netChart.update("none");
      }
      if (typeof pingChart !== "undefined" && pingChart) {
        pingChart.options.scales.y.ticks.color = tickColor;
        pingChart.options.scales.y.grid.color = gridColor;
        pingChart.update("none");
      }
    }

    function toggleTheme(mode) {
      const container = document.getElementById("custom_status_container");
      if (!container) return;
      container.classList.remove("theme-light", "theme-dark");
      container.classList.add(mode === "light" ? "theme-light" : "theme-dark");
      applyChartTheme(mode !== "light");
      try {
        localStorage.setItem("__custom_theme", mode);
      } catch (_) {}
    }

    (function initTheme() {
      let mode = "dark";
      try {
        mode =
          window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
        window
          .matchMedia("(prefers-color-scheme: dark)")
          .addEventListener("change", (e) =>
            toggleTheme(e.matches ? "dark" : "light"),
          );
      } catch (_) {}
      toggleTheme(mode);
    })();

    /* rolling line charts, no animation while the data shifts or the
       line flickers for a frame. only the intro at load time is animated. */
    function dashLineChartLiveUpdate(chart) {
      if (!chart) return;
      chart.update("none");
    }

    var pingChart = null;
    /* leave some room on top of the peak and round it so the 3 tick
       labels look neat */
    function pingChartYAxisMax(peakMs) {
      const padded = peakMs <= 0 ? 10 : Math.ceil(Number(peakMs) * 1.15);
      let m = Math.max(10, padded);
      if (m <= 30) return Math.ceil(m / 5) * 5;
      if (m <= 100) return Math.ceil(m / 10) * 10;
      if (m <= 250) return Math.ceil(m / 25) * 25;
      return Math.ceil(m / 50) * 50;
    }

    /* the three rolling line charts share the same skeleton, only the
       dataset, the y axis and the tooltip differ */
    function lineChartOptions(yScale, tooltip, extra) {
      const opts = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", intersect: false },
        layout: { padding: { top: 4, bottom: 2, left: 2, right: 2 } },
        plugins: { legend: { display: false }, tooltip: tooltip },
        scales: { y: yScale, x: { display: false } },
      };
      return extra ? Object.assign(opts, extra) : opts;
    }

    function ensurePingChart() {
      const canvas = document.getElementById("pingChart");
      if (!canvas) return false;
      if (pingChart) return true;
      const isDark = !document
        .getElementById("custom_status_container")
        ?.classList.contains("theme-light");
      const tickColor = THEME_COLORS.tick(isDark);
      const gridColor = THEME_COLORS.grid(isDark);
      pingChart = new Chart(canvas, {
        type: "line",
        devicePixelRatio: window.devicePixelRatio || 1,
        data: {
          labels: [],
          datasets: [
            {
              data: [],
              borderColor: "#43a047",
              backgroundColor: "rgba(67,160,71,0.12)",
              fill: true,
              borderWidth: 2,
              tension: 0.25,
              spanGaps: true,
              pointRadius: 0,
              pointHoverRadius: 3,
              pointHoverBackgroundColor: "#43a047",
              pointHoverBorderColor: "#fff",
              pointHoverBorderWidth: 1.5,
            },
          ],
        },
        options: lineChartOptions(
          {
            min: 0,
            max: 50,
            ticks: {
              font: { size: window.innerWidth >= 768 ? 8.5 : 8 },
              padding: 0,
              color: tickColor,
              count: 3,
              maxTicksLimit: 3,
              callback: (v) => {
                const n = Number(v);
                if (!isFinite(n)) return "";
                return (
                  (Math.abs(n - Math.round(n)) < 1e-6
                    ? String(Math.round(n))
                    : n.toFixed(1)) + " ms"
                );
              },
            },
            grid: { drawTicks: false, color: gridColor },
            border: { display: false },
          },
          {
            enabled: true,
            callbacks: {
              label: (ctx) => {
                const v = ctx.raw;
                if (v == null || !isFinite(v)) return "Ping: —";
                return "Ping: " + Number(v).toFixed(1) + " ms";
              },
            },
          },
          { elements: { point: { radius: 0 } } },
        ),
      });
      return true;
    }

    /* wan chart */
    function createCpuCoreChart(anchor, isDark, withIntro) {
      const section = document.createElement("div");
      section.className = "cpu-core-section";
      section.id = "cpu_core_section";
      section.innerHTML =
        '<div class="cpu-core-label">Cores</div><div class="cpu-core-canvas-wrap"><canvas id="cpuCoreChart"></canvas></div>';
      anchor.insertAdjacentElement("afterend", section);

      const chart = new Chart(document.getElementById("cpuCoreChart"), {
        type: "bar",
        data: {
          labels: [],
          datasets: [
            {
              data: [],
              backgroundColor: [],
              borderRadius: 3,
              borderSkipped: false,
            },
          ],
        },
        plugins: [coreBarLabelPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: withIntro
            ? {
                duration: 500,
                easing: "easeOutQuart",
                delay: (ctx) =>
                  ctx.type === "data" && ctx.mode === "default"
                    ? ctx.dataIndex * 35
                    : 0,
              }
            : {
                duration: 280,
                easing: "easeOutQuart",
              },
          layout: {
            padding: { top: 20, bottom: 0, left: 2, right: 2 },
          },
          plugins: {
            legend: { display: false },
            tooltip: Object.assign({}, cpuChartTooltipPlugins(), {
              callbacks: {
                title: () => null,
                label: (ctx) =>
                  "Core " +
                  (ctx.dataIndex + 1) +
                  ": " +
                  Number(ctx.raw).toFixed(1) +
                  "%",
              },
            }),
          },
          scales: {
            y: {
              min: 0,
              max: 100,
              ticks: {
                display: false,
                color: THEME_COLORS.tick(isDark),
              },
              grid: {
                color: THEME_COLORS.grid(isDark),
                drawTicks: false,
              },
              border: { display: false },
            },
            x: { display: false },
          },
        },
      });

      if (withIntro) {
        setTimeout(() => {
          if (chart) {
            chart.options.animation = {
              duration: 280,
              easing: "easeOutQuart",
            };
          }
        }, 600);
      }
      return chart;
    }

    function wanNetChartTooltip() {
      return {
        enabled: false,
        intersect: false,
        external: function (context) {
          const chart = context.chart;
          const tooltip = context.tooltip;
          const el = createTooltipEl(
            "wan_net_chart_tooltip_el",
            "wan_net_chart_tooltip",
          );

          const dps = tooltip && tooltip.dataPoints;
          if (!chart || !tooltip || tooltip.opacity === 0 || !dps || dps.length < 2) {
            hideTooltip(el);
            return;
          }

          const cr = window.CustomRealtime;
          if (!cr || typeof cr.formatWanRate !== "function") return;

          const fmt = cr.formatWanRate.bind(cr);
          const esc =
            typeof cr.escapeHtml === "function"
              ? cr.escapeHtml.bind(cr)
              : (s) => String(s);
          const rx = dps[0].raw;
          const tx = dps[1].raw;
          const arr = "\u2B07";
          el.innerHTML =
            '<div class="wan_net_chart_tooltip_line">' +
            '<span class="wan_net_chart_arr wan_net_chart_arr--rx">' +
            arr +
            "</span>" +
            '<span class="wan_net_chart_txt wan_net_chart_txt--rx">' +
            '<span class="wan_net_chart_lbl"> RX: </span>' +
            esc(fmt(rx)) +
            "</span></div>" +
            '<div class="wan_net_chart_tooltip_line">' +
            '<span class="wan_net_chart_arr wan_net_chart_arr--tx">' +
            arr +
            "</span>" +
            '<span class="wan_net_chart_txt wan_net_chart_txt--tx">' +
            '<span class="wan_net_chart_lbl"> TX: </span>' +
             esc(fmt(tx)) +
             "</span></div>";

           positionTooltip(el, chart, tooltip);
         },
      };
    }

    var netChart = null;

    function initNetChart() {
      const canvas = document.getElementById("netChart");
      if (!canvas) return;
      if (typeof netChart !== "undefined" && netChart) return;

      const isDark = !document
        .getElementById("custom_status_container")
        ?.classList.contains("theme-light");

      const WAN_HISTORY_LEN = 60;
      const initLabels = Array.from({ length: WAN_HISTORY_LEN }, () => "");
      const initData = Array.from({ length: WAN_HISTORY_LEN }, () => 0);

      netChart = new Chart(canvas, {
        type: "line",
        devicePixelRatio: window.devicePixelRatio || 1,
        data: {
          labels: [...initLabels],
          datasets: [
            {
              data: [...initData],
              borderColor: getComputedStyle(document.documentElement)
                .getPropertyValue("--rx-tint")
                .trim(),
              backgroundColor: "rgba(78,168,255,0.10)",
              fill: true,
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 2.5,
              pointHoverBackgroundColor: getComputedStyle(
                document.documentElement,
              )
                .getPropertyValue("--rx-tint")
                .trim(),
              pointHoverBorderColor: "#fff",
              pointHoverBorderWidth: 1.5,
            },
            {
              data: [...initData],
              borderColor: getComputedStyle(document.documentElement)
                .getPropertyValue("--tx-tint")
                .trim(),
              backgroundColor: "rgba(76,208,138,0.10)",
              fill: true,
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 2,
              pointHoverBackgroundColor: getComputedStyle(
                document.documentElement,
              )
                .getPropertyValue("--tx-tint")
                .trim(),
              pointHoverBorderColor: "#fff",
              pointHoverBorderWidth: 1.5,
            },
          ],
        },
        options: lineChartOptions(
          {
            min: 0,
            ticks: {
              font: { size: window.innerWidth >= 768 ? 8.5 : 8 },
              padding: 0,
              color: THEME_COLORS.tick(isDark),
              callback: (v) => window.CustomRealtime.formatWanRate(v),
            },
            grid: { drawTicks: false, color: THEME_COLORS.gridNet(isDark) },
            border: { display: false },
          },
          wanNetChartTooltip(),
          {
            interaction: { mode: "index", intersect: false },
            layout: { padding: { top: 4, bottom: 0, left: 2, right: 2 } },
          },
        ),
      });

      const cr = window.CustomRealtime;
      if (cr && cr.rxHistory && cr.rxHistory.length) {
        const len = cr.rxHistory.length;
        const start = Math.max(0, WAN_HISTORY_LEN - len);
        for (let i = 0; i < len; i++) {
          netChart.data.datasets[0].data[start + i] = cr.rxHistory[i];
          netChart.data.datasets[1].data[start + i] = cr.txHistory[i];
        }
        netChart.update("none");
      }
    }

    /* cpu line chart */
    var cpuLineChart = null;
    var _cpuCanvas = document.getElementById("cpuLineChart");
    if (_cpuCanvas) {
      cpuLineChart = new Chart(_cpuCanvas, {
        type: "line",
        devicePixelRatio: window.devicePixelRatio || 1,
        data: {
          labels: [],
          datasets: [
            {
              data: [],
              borderColor: "#7e57c2",
              borderWidth: 2,
              tension: 0.35,
              pointRadius: 0,
              pointHoverRadius: 2.5,
              pointHoverBackgroundColor: "#7e57c2",
              pointHoverBorderColor: "#fff",
              pointHoverBorderWidth: 1.5,
              fill: true,
              backgroundColor: "rgba(126,87,194,0.15)",
            },
          ],
        },
        options: lineChartOptions(
          {
            min: 0,
            max: 100,
            ticks: {
              callback: (v) => v + "%",
              font: { size: 8.5 },
              maxTicksLimit: 5,
              padding: 2,
              color: "rgba(255,255,255,0.65)",
            },
            grid: { color: "rgba(255,255,255,0.05)" },
            border: { display: false },
          },
          Object.assign({}, cpuChartTooltipPlugins(), {
            callbacks: {
              label: (ctx) => "CPU: " + Number(ctx.raw).toFixed(1) + "%",
            },
          }),
          {
            responsive: false,
            layout: { padding: { top: 4, bottom: 6, left: 2, right: 2 } },
          },
        ),
      });
    }

    /* cpu core chart, made when the core data shows up */
    var cpuCoreChart = null;

    const coreBarLabelPlugin = {
      id: "coreBarLabel",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const dataset = chart.data.datasets[0];
        const isDark = !document
          .getElementById("custom_status_container")
          ?.classList.contains("theme-light");
        const colorSub = isDark
          ? "rgba(255,255,255,0.45)"
          : "rgba(30,30,40,0.55)";
        const dpr =
          chart.currentDevicePixelRatio || window.devicePixelRatio || 1;
        const fMain = Math.round(9 * dpr) / dpr;
        const fSub = Math.round(7.5 * dpr) / dpr;
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
          const value = dataset.data[i];
          if (value == null) return;
          const px = Math.round(bar.x * dpr) / dpr;
          const yMain = Math.round((bar.y - 11) * dpr) / dpr;
          const ySub = Math.round((bar.y - 2) * dpr) / dpr;
          ctx.save();
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          const barColor =
            dataset.backgroundColor && dataset.backgroundColor[i]
              ? dataset.backgroundColor[i]
              : THEME_COLORS.tick(isDark);
          ctx.fillStyle = barColor;
          ctx.font = "600 " + fMain + "px sans-serif";
          ctx.fillText(
            (chart.data.labels[i] || "C" + (i + 1)) +
              ": " +
              Number(value).toFixed(1) +
              "%",
            px,
            yMain,
          );
          const coreCount = chart.data.datasets[0].data.length;
          if (coreCount <= 4) {
            const avg =
              chart._coreAvg && chart._coreAvg[i] != null
                ? chart._coreAvg[i].toFixed(1) + "%"
                : "--";
            const max =
              chart._coreMax && chart._coreMax[i] != null
                ? chart._coreMax[i].toFixed(1) + "%"
                : "--";
            ctx.fillStyle = colorSub;
            ctx.font = "600 " + fSub + "px sans-serif";
            ctx.fillText("Avg: " + avg + "  Max: " + max, px, ySub);
          }
          ctx.restore();
        });
      },
    };

    /* apply the theme again now that the charts are there */
    (function () {
      applyChartTheme(
        !document
          .getElementById("custom_status_container")
          ?.classList.contains("theme-light"),
      );
    })();

    /* wan unit dropdown */
    (function () {
      const wanMenu = document.getElementById("wan_unit_menu");
      const wanUnitLabel = document.getElementById("wan_unit_label");
      const wanDd = setupDropdown("wan_unit_dropdown", "wan_unit_trigger");

      function applyWanUnit(unit) {
        const cr = window.CustomRealtime;
        cr.wanUnit = unit;
        try { localStorage.setItem("__dashboard_wan_unit", unit); } catch (_) {}
        if (wanUnitLabel)
          wanUnitLabel.textContent = unit === "MBs" ? "MB/s" : "Mbps";
        if (wanMenu) {
          wanMenu.querySelectorAll(".wan-unit-option").forEach((opt) => {
            const sel = opt.dataset.unit === unit;
            opt.classList.toggle("active", sel);
            opt.setAttribute("aria-selected", String(sel));
          });
        }
        cr.refreshWanRates();
        if (netChart) netChart.update("none");
      }

      if (wanMenu) {
        wanMenu.querySelectorAll(".wan-unit-option").forEach((opt) => {
          opt.addEventListener("click", (e) => {
            e.stopPropagation();
            applyWanUnit(opt.dataset.unit);
            if (wanDd) wanDd.close();
          });
        });
      }

      const cr = window.CustomRealtime;
      if (cr) applyWanUnit(cr.wanUnit);
    })();

    /* vnstat interface dropdown */
    (function () {
      const menu = document.getElementById("vn_iface_menu");
      const labelEl = document.getElementById("vn_iface_label");
      const card = document.getElementById("vnstat_card");
      const vnDd = setupDropdown(
        "vn_iface_dropdown",
        "vn_iface_trigger",
        (open) => {
          if (card) card.classList.toggle("dropdown-open", open);
        },
      );

      function applyVnstatIface(iface) {
        const cr = window.CustomRealtime;
        if (!cr) return;
        cr.vnstatIface = iface;
        try { localStorage.setItem("__dashboard_vnstat_iface", iface); } catch (_) {}

        if (labelEl) {
          const rawIfaces = Array.isArray(
            cr.lastVnstatData && cr.lastVnstatData.ifaces,
          )
            ? cr.lastVnstatData.ifaces
            : [];
          labelEl.textContent = vnstatIfaceLabel(rawIfaces, iface);
        }

        if (menu) {
          menu.querySelectorAll(".dropdown-option").forEach((opt) => {
            const sel = opt.dataset.iface === iface;
            opt.classList.toggle("active", sel);
            opt.setAttribute("aria-selected", String(sel));
          });
        }
        if (cr.lastVnstatData) cr.renderVnstatData(cr.lastVnstatData);
        if (vnDd) vnDd.close();
      }

      if (menu) {
        menu.addEventListener("click", (e) => {
          const opt = e.target.closest(".dropdown-option");
          if (opt) {
            e.stopPropagation();
            applyVnstatIface(opt.dataset.iface);
          }
        });
      }
    })();

    (function () {
      let resizeTimer;

      function resizeAllCharts() {
        if (typeof netChart !== "undefined" && netChart) {
          netChart.options.scales.y.ticks.font.size =
            window.innerWidth >= 768 ? 8.5 : 8;
          netChart.resize();
        }
        if (typeof cpuLineChart !== "undefined" && cpuLineChart)
          cpuLineChart.resize();
        if (typeof cpuCoreChart !== "undefined" && cpuCoreChart)
          cpuCoreChart.resize();
        if (typeof pingChart !== "undefined" && pingChart) {
          pingChart.options.scales.y.ticks.font.size =
            window.innerWidth >= 768 ? 8.5 : 8;
          pingChart.resize();
        }

        const cr = window.CustomRealtime;
        if (cr && cr.memSparkHistory.length > 1)
          cr.drawSparkline(
            cr._sparkHoverIdx != null ? cr._sparkHoverIdx : null,
          );
      }

      function onResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resizeAllCharts, 150);
      }

      window.addEventListener("resize", onResize);
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => onResize());
        const wNet = document.querySelector(".wan_merged_chart");
        const wCpu = document.querySelector(".cpu_merged_chart");
        const wPing = document.querySelector(".ping_chart_wrap");
        if (wNet) ro.observe(wNet);
        if (wCpu) ro.observe(wCpu);
        if (wPing) ro.observe(wPing);
      }
      if (screen.orientation) {
        screen.orientation.addEventListener("change", onResize);
      } else {
        window.addEventListener("orientationchange", onResize);
      }

      (function watchDPR() {
        const mq = window.matchMedia(
          "(resolution: " + window.devicePixelRatio + "dppx)",
        );
        mq.addEventListener("change", function handler() {
          mq.removeEventListener("change", handler);
          onResize();
          watchDPR();
        });
      })();
    })();

    (function initPingChartToggle() {
      const btn = document.getElementById("net_status_trigger");
      const panel = document.getElementById("ping_chart_panel");
      const wrap = document.querySelector(".net_status_popover");
      if (!btn || !panel || !wrap) return;

      function applyTheme() {
        const container = document.getElementById("custom_status_container");
        const isLight = container?.classList.contains("theme-light");
        panel.classList.toggle("popup-theme-light", isLight);
      }
      applyTheme();
      const themeObserver = new MutationObserver(applyTheme);
      const themeContainer = document.getElementById("custom_status_container");
      if (themeContainer)
        themeObserver.observe(themeContainer, {
          attributes: true,
          attributeFilter: ["class"],
        });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      function openPopup() {
        panel.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        requestAnimationFrame(() => {
          if (typeof pingChart !== "undefined" && pingChart) {
            pingChart.resize();
            pingChart.update("none");
          }
        });
      }
      function closePopup() {
        if (panel.hidden) return;
        panel.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.hidden ? openPopup() : closePopup();
      });
      panel.addEventListener("click", (e) => e.stopPropagation());
      document.addEventListener("click", (e) => {
        if (panel.hidden) return;
        if (!wrap.contains(e.target)) closePopup();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !panel.hidden) closePopup();
      });
    })();

    /* start the charts with a flat zero line, they draw in once */
    (function seedChartsOnLoad() {
      const SEED_POINTS = 60;
      const labels = Array(SEED_POINTS).fill("");
      const motionOk = !(
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
      const INTRO_MS = 640;
      const introAnim = { duration: INTRO_MS, easing: "easeOutQuart" };

      function runLineChartIntro(chart, delayMs) {
        if (!chart) return;
        const go = () => {
          chart.options.animation = introAnim;
          chart.update();
          window.setTimeout(() => {
            chart.options.animation = false;
          }, INTRO_MS + 80);
        };
        if (delayMs > 0) window.setTimeout(go, delayMs);
        else go();
      }

      // no seed for the wan chart, the data fills in from the right
      if (typeof netChart !== "undefined" && netChart) {
        netChart.update("none");
      }

      if (typeof cpuLineChart !== "undefined" && cpuLineChart) {
        cpuLineChart.data.labels = labels.slice();
        cpuLineChart.data.datasets[0].data = Array(SEED_POINTS).fill(0);
        if (motionOk) runLineChartIntro(cpuLineChart, 140);
        else cpuLineChart.update("none");
      }
    })();

    /* eye buttons to show or hide the ip */
    (function () {
      const ipv4EyeBtn = document.getElementById("ipv4_eye_btn");
      const ipv6EyeBtn = document.getElementById("ipv6_eye_btn");
      const ipv4Value = document.getElementById("net_public_ip");
      const ipv6Value = document.getElementById("net_public_ipv6");

      // get the saved preference from localStorage
      const getSavedVisibility = (key, defaultValue) => {
        try {
          const saved = localStorage.getItem(key);
          return saved !== null ? saved === "true" : defaultValue;
        } catch (_) {
          return defaultValue;
        }
      };

      // ip is hidden by default
      let ipv4Visible = getSavedVisibility("dashboard_ipv4_visible", false);
      let ipv6Visible = getSavedVisibility("dashboard_ipv6_visible", false);

      const applyVisibility = () => {
        const applyOne = (btn, valueEl, visible, storageKey) => {
          if (!btn || !valueEl) return;
          btn.classList.toggle("ip-eye-btn--masked", !visible);
          const original = valueEl.dataset.original || valueEl.textContent;
          if (visible) {
            valueEl.textContent = original;
            valueEl.classList.remove("ip-value--masked");
            valueEl.style.filter = "none";
          } else {
            valueEl.textContent = maskIpText(original);
            valueEl.classList.add("ip-value--masked");
            valueEl.style.filter = "blur(1px)";
          }
          valueEl.style.userSelect = visible ? "auto" : "none";
          valueEl.style.pointerEvents = visible ? "auto" : "none";
          try { localStorage.setItem(storageKey, visible); } catch (_) {}
        };
        applyOne(ipv4EyeBtn, ipv4Value, ipv4Visible, "dashboard_ipv4_visible");
        applyOne(ipv6EyeBtn, ipv6Value, ipv6Visible, "dashboard_ipv6_visible");
      };

      // toggle the ip
      const toggleIPv4 = () => {
        ipv4Visible = !ipv4Visible;
        applyVisibility();
      };

      const toggleIPv6 = () => {
        ipv6Visible = !ipv6Visible;
        applyVisibility();
      };

      // button clicks
      if (ipv4EyeBtn) {
        ipv4EyeBtn.addEventListener("click", toggleIPv4);
      }

      if (ipv6EyeBtn) {
        ipv6EyeBtn.addEventListener("click", toggleIPv6);
      }

      // set the ip visibility the first time
      applyVisibility();
    })();

    /* start */
    if (document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", () =>
        window.CustomRealtime.start(),
      );
    } else {
      window.CustomRealtime.start();
    }
