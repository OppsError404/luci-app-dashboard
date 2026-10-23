var backupExists = false;
var tmpFreeKb = 0;
var flashFreeKb = 0;

function fmtSize(kb) {
  if (kb >= 1073741824) return (kb / 1073741824).toFixed(2) + ' TB';
  if (kb >= 1048576)    return (kb / 1048576).toFixed(2) + ' GB';
  if (kb >= 1024)       return (kb / 1024).toFixed(2) + ' MB';
  return kb + ' KB';
}

function showResult(el, ok, msg) {
  el.className = 'result-banner ' + (ok ? 'ok' : 'err');
  el.innerHTML = (ok ? '&#10003;&nbsp;' : '&#10007;&nbsp;') + msg;
  el.style.display = 'block';
}

/* a stat pill in the strip at the top of the page */
function setStat(el, cls, text) {
  if (!el) return;
  el.className = 'sp-val' + (cls ? ' ' + cls : '');
  el.textContent = text;
}

/* the load and the restore button, they always get enabled together */
function enableRestoreButtons() {
  [['irs_btn', 'Load'], ['irs_btn_2', 'Restore']].forEach(function (p) {
    var el = document.getElementById(p[0]);
    if (el) { el.disabled = false; el.classList.remove('disabled'); el.textContent = p[1]; }
  });
}

function setBtnLoading(btn, loading) {
  if (loading) {
    btn._orig    = btn.innerHTML;
    btn.innerHTML = '<span class="spin"></span>&nbsp;Working&hellip;';
    btn.disabled = true;
    btn.classList.add('disabled');
  } else {
    btn.innerHTML = btn._orig || btn.innerHTML;
    btn.disabled  = false;
    btn.classList.remove('disabled');
  }
}

function clearUpload() {
  var fi = document.getElementById('upload_file');
  if (fi) {
    fi.value = '';
    onFileSelect();
  }
}

function onFileSelect() {
  var fi = document.getElementById('upload_file');
  var cl = document.getElementById('upload_clear');
  var ub = document.getElementById('upload_btn');
  var rs = document.getElementById('irs_btn_2');
  var res = document.getElementById('upload_result');
  var hasFile = (fi.files && fi.files[0]);
  
  ub.disabled = true;
  ub.classList.add('disabled');
  res.style.display = 'none';
  if (rs) {
    rs.disabled = true;
    rs.classList.add('disabled');
  }

  if (cl) cl.style.display = hasFile ? 'block' : 'none';

  if (!hasFile) return;

  var file = fi.files[0];
  if (!file.name.match(/\.gz$/i)) {
    showResult(res, false, 'File must have .gz extension.');
    return;
  }

  var file_kb    = Math.ceil(file.size / 1024);
  var ok_tmp   = (file_kb <= tmpFreeKb);
  var ok_flash = (file_kb <= flashFreeKb);

  if (!ok_tmp || !ok_flash) {
    var err = "<b>Storage Warning:</b> Not enough space to process this file.<br>";
    if (!ok_tmp)   err += "&nbsp;&bull; /tmp (RAM) needs " + file_kb + " KB, but only has " + tmpFreeKb + " KB.<br>";
    if (!ok_flash) err += "&nbsp;&bull; Flash storage needs " + file_kb + " KB, but only has " + flashFreeKb + " KB.";
    showResult(res, false, err);
    return;
  }

  var reader = new FileReader();
  reader.onload = function(e) {
    var bytes = new Uint8Array(e.target.result);
    if (bytes.length >= 2 && bytes[0] === 0x1F && bytes[1] === 0x8B) {
      ub.disabled = false;
      ub.classList.remove('disabled');
    } else {
      showResult(res, false, 'Invalid file: Not a valid GZIP archive.');
    }
  };
  reader.onerror = function() {
    showResult(res, false, 'Error reading file header.');
  };
  reader.readAsArrayBuffer(file.slice(0, 2));
}

function updateStats(data, type) {
  if (!data.ok) return;
  if (type === 'backup') {
    backupExists = true;
    var st = document.getElementById('ss_backup_state');
    var sz = document.getElementById('ss_backup_size');
    var ts = document.getElementById('ss_last_bk');
    var tr = document.getElementById('ss_last_bk_trig');
    var cs = document.getElementById('cm_size');
    var cm = document.getElementById('cm_mtime');
    setStat(st, 'ok', '\u2713 Found');
    if (sz && data.size_kb) sz.textContent = data.size_kb + ' KB';
    if (ts && data.mtime)   ts.textContent = data.mtime;
    if (tr) tr.textContent = 'via ' + (data.trigger || 'manual');
    if (cs && data.size_kb) cs.textContent = data.size_kb + ' KB';
    if (cm && data.mtime)   cm.textContent = data.mtime;
    enableRestoreButtons();
    refreshDownloadLink();
  } else {
    var rs = document.getElementById('ss_last_rs');
    var rt = document.getElementById('ss_last_rs_trig');
    if (rs && data.ts) rs.textContent = data.ts;
    if (rt) rt.textContent = 'via ' + (data.trigger || 'manual');
  }
}

function refreshDownloadLink() {
  var actions = document.getElementById('download_actions');
  var meta = document.getElementById('download_meta');
  if (backupExists) {
    actions.innerHTML = '<a class="btn blue" href="/cgi-bin/cgi-download?sid=' + encodeURIComponent(DASHBOARD_SID) + '&path=/etc/vnstat/backup/vnstat.db.gz&filename=vnstat.db.gz">Download</a>';
    meta.style.display = '';
  } else {
    actions.innerHTML = '<a class="btn blue disabled">No backup available</a>';
    meta.style.display = 'none';
  }
}

function showVnbkModal(title, msg, onConfirm) {
  var ovl = document.getElementById('vnbk_modal_ovl');
  var cb = document.getElementById('vnbk_modal_confirm');
  document.getElementById('vnbk_modal_title').innerText = title;
  document.getElementById('vnbk_modal_msg').innerText = msg;
  ovl.classList.add('show');
  cb.onclick = function() {
    hideVnbkModal();
    onConfirm();
  };
}

function hideVnbkModal() {
  document.getElementById('vnbk_modal_ovl').classList.remove('show');
}

function doAction(type, btnId, resId) {
  if (type === 'restore') {
    var title = (btnId === 'irs_btn') ? "Load Database Backup" : "Confirm Database Restore";
    var msg = (btnId === 'irs_btn') 
      ? "This operation will stop the vnStat service and replace the current live traffic data in /tmp with the backup from flash. Any unsaved data in the current session will be lost."
      : "This operation will stop the vnStat service and replace the current live traffic data in /tmp with the new database. Any unsaved data in the current session will be lost.";
    
    if (btnId === 'irs_btn_2' && backupExists) {
      title = "Overwrite Existing Backup";
      msg = "A database backup already exists in flash storage. Restoring the new file will overwrite the existing backup and replace your current live traffic data in /tmp.";
    }
    
    showVnbkModal(title, msg, function() {
      executeAction(type, btnId, resId);
    });
  } else {
    executeAction(type, btnId, resId);
  }
}

function executeAction(type, btnId, resId) {
  var isBackup = (type === 'backup');
  var btn    = document.getElementById(btnId);
  var result = document.getElementById(resId);

  result.style.display = 'none';
  setBtnLoading(btn, true);

  var method = isBackup ? 'vnstat_backup' : 'vnstat_restore';
  ubusCall('dashboard', method)
    .then(function(d) {
      setBtnLoading(btn, false);
      if (d.ok) {
        var msg = d.message;
        if (d.size_kb) msg += '&nbsp;&middot;&nbsp;' + d.size_kb + ' KB';
        if (d.mtime)   msg += '&nbsp;&middot;&nbsp;' + d.mtime;
        if (d.ts)      msg += '&nbsp;&middot;&nbsp;' + d.ts;
        showResult(result, true, msg);
        updateStats(d, type);
        
        if (type === 'restore') {
          if (d.size_kb) updateStats(d, 'backup');
          var fi = document.getElementById('upload_file');
          if (fi) {
            fi.value = '';
            onFileSelect();
          }
        }
      } else {
        showResult(result, false, d.error || 'Unknown error');
      }
    })
    .catch(function(e) {
      setBtnLoading(btn, false);
      showResult(result, false, 'Request failed: ' + e);
    });
}

function doUpload() {
  var fi     = document.getElementById('upload_file');
  var result = document.getElementById('upload_result');
  var btn    = document.getElementById('upload_btn');

  result.style.display = 'none';

  if (!fi.files || !fi.files[0]) {
    showResult(result, false, 'Please select a .gz file first.'); return;
  }
  
  var reader = new FileReader();
  reader.onload = function() {
    setBtnLoading(btn, true);
    fetch('/cgi-bin/cgi-upload?sid=' + encodeURIComponent(DASHBOARD_SID) + '&path=/tmp/dashboard/vnstat_upload.gz', {
      method: 'POST',
      body: reader.result,
    })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        setBtnLoading(btn, false);
        if (d.code === 0) {
          showResult(result, true, 'Database uploaded to /tmp and validated.');
          enableRestoreButtons();
        } else {
          showResult(result, false, d.stderr || d.detail || 'Upload failed');
        }
      })
      .catch(function(e) {
        setBtnLoading(btn, false);
        showResult(result, false, 'Request failed: ' + e);
      });
  };
  
  reader.onerror = function() {
    showResult(result, false, 'Failed to read file.');
  };
  
  reader.readAsArrayBuffer(fi.files[0]);
}

// auto backup toggle
var abToggleEl, abWrapEl, abLabelEl, abSubEl, abIntervalEl;
var abBusy = false;

function cacheAutoBackupElements() {
  abToggleEl = document.getElementById('ab_toggle');
  abWrapEl = document.getElementById('ab_toggle_wrap');
  abLabelEl = document.getElementById('ab_toggle_label');
  abSubEl = document.getElementById('ab_toggle_sub');
  abIntervalEl = document.getElementById('ab_toggle_interval');
}

function applyAutoBackupState(on, interval) {
  if (!abToggleEl) return;

  abToggleEl.classList.toggle('on', !!on);
  abToggleEl.setAttribute('aria-checked', String(!!on));
  if (abWrapEl) abWrapEl.classList.toggle('on', !!on);
  if (abLabelEl) abLabelEl.textContent = on ? 'Auto backup on' : 'Auto backup off';
  if (abIntervalEl) abIntervalEl.textContent = on ? (interval || 'every 12h') : 'Off';
  if (abSubEl) abSubEl.style.display = on ? '' : 'none';
}

function setAutoBackupBusy(busy) {
  abBusy = busy;
  if (!abToggleEl) return;
  abToggleEl.classList.toggle('busy', busy);
  abToggleEl.classList.toggle('loading', busy);
}

function toggleAutoBackup() {
  if (!abToggleEl || abBusy) return;
  var isOn = abToggleEl.classList.contains('on');
  var newVal = isOn ? '0' : '1';

  setAutoBackupBusy(true);
  // flip it right away, fix it later if it fails
  applyAutoBackupState(!isOn, abIntervalEl ? abIntervalEl.textContent : null);

  ubusCall('dashboard', 'set_settings', { key: 'vnstat_db', val: newVal })
    .then(function(d) {
      if (!d || !d.ok) {
        applyAutoBackupState(isOn, abIntervalEl ? abIntervalEl.textContent : null);
        return;
      }
      // get the real state again, the interval may have changed
      ubusCall('dashboard', 'vnstat_info').then(function(info) {
        applyAutoBackupState(info.auto_enabled, info.auto_interval);
      }).catch(function() {});
    })
    .catch(function() {
      applyAutoBackupState(isOn, abIntervalEl ? abIntervalEl.textContent : null);
    })
    .finally(function() { setAutoBackupBusy(false); });
}

function initAutoBackupToggle() {
  cacheAutoBackupElements();
  var t = abToggleEl;
  if (!t) return;
  t.addEventListener('click', toggleAutoBackup);
  t.addEventListener('keydown', function(e) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggleAutoBackup();
    }
  });
}

// load the page data with ubus
function initPage() {
  cacheAutoBackupElements();
  ubusCall('dashboard', 'vnstat_info').then(function(info) {
    tmpFreeKb = parseInt(info.tmp_free_kb) || 0;
    flashFreeKb = parseInt(info.flash_free_kb) || 0;
    document.getElementById('tmp_free_kb').textContent = fmtSize(tmpFreeKb);
    document.getElementById('flash_free_kb').textContent = fmtSize(flashFreeKb);

    // auto backup toggle
    applyAutoBackupState(info.auto_enabled, info.auto_interval);

    // backup state
    backupExists = info.backup_exists;
    var bs = document.getElementById('ss_backup_state');
    var sz = document.getElementById('ss_backup_size');
    if (info.backup_exists) {
      setStat(bs, 'ok', '\u2713 Found');
      sz.textContent = info.backup_size_kb + ' KB';
      var cm = document.getElementById('cm_mtime');
      var cs = document.getElementById('cm_size');
      if (cm) cm.textContent = info.backup_mtime || '—';
      if (cs) cs.textContent = info.backup_size_kb + ' KB';
    } else {
      setStat(bs, 'miss', '\u2717 Missing');
      sz.textContent = '—';
    }

    // db state
    var ds = document.getElementById('ss_db_state');
    var dz = document.getElementById('ss_db_size');
    if (info.db_exists) {
      setStat(ds, 'ok', '\u2713 Present');
      dz.textContent = info.db_size_kb + ' KB';
    } else {
      setStat(ds, 'miss', '\u2717 Absent');
      dz.textContent = '—';
    }

    // last backup
    var bk = document.getElementById('ss_last_bk');
    var bt = document.getElementById('ss_last_bk_trig');
    if (info.last_backup_ts) {
      setStat(bk, '', info.last_backup_ts);
      bt.textContent = 'via ' + (info.last_backup_trigger || '—');
    } else if (info.backup_mtime) {
      setStat(bk, '', info.backup_mtime);
      bt.textContent = '—';
    } else {
      setStat(bk, 'dim', 'never');
      bt.textContent = '—';
    }

    // last restore
    var rs = document.getElementById('ss_last_rs');
    var rt = document.getElementById('ss_last_rs_trig');
    if (info.last_restore_ts) {
      setStat(rs, '', info.last_restore_ts);
      rt.textContent = 'via ' + (info.last_restore_trigger || '—');
    } else {
      setStat(rs, 'dim', 'never');
      rt.textContent = '—';
    }

    // restore button
    var irs = document.getElementById('irs_btn');
    if (irs) {
      if (info.backup_exists) {
        irs.disabled = false; irs.classList.remove('disabled'); irs.textContent = 'Load';
      } else {
        irs.textContent = 'No backup found';
      }
    }

    refreshDownloadLink();
  }).catch(function(e) {
    console.error('Failed to load vnstat info:', e);
  });

  initAutoBackupToggle();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
