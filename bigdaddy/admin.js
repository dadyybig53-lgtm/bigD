(function () {
  'use strict';

  var TOKEN_KEY = 'bdAdminToken';
  var refreshTimer = null;

  /* ─── API helper ─────────────────────────────────────── */
  function api(path, options) {
    var token = localStorage.getItem(TOKEN_KEY);
    var headers = Object.assign({ 'Content-Type': 'application/json' }, (options && options.headers) || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(path, Object.assign({}, options, { headers: headers })).then(function (res) {
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.replace('/admin-login.html');
        throw new Error('Session expired');
      }
      return res;
    });
  }

  /* ─── Auth check on load ─────────────────────────────── */
  var guard = document.getElementById('authGuard');
  var dashboard = document.getElementById('dashboardView');

  var token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.replace('/admin-login.html');
  } else {
    api('/api/admin/settings').then(function (res) {
      if (!res.ok) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.replace('/admin-login.html');
        return;
      }
      guard.style.display = 'none';
      dashboard.style.display = 'flex';
      startDashboard();
    }).catch(function () {
      window.location.replace('/admin-login.html');
    });
  }

  /* ─── Helpers ────────────────────────────────────────── */
  function fmt(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    } catch (e) { return iso; }
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isTodayIST(iso) {
    if (!iso) return false;
    try {
      var d = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      var t = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      return d === t;
    } catch (e) { return false; }
  }

  function emptyRow(cols, msg) {
    return '<tr><td colspan="' + cols + '" class="empty-row">' + esc(msg) + '</td></tr>';
  }

  function emailTag(email) {
    return email
      ? '<span class="tag tag-email">' + esc(email) + '</span>'
      : '<span class="muted">—</span>';
  }

  function ipTag(ip) {
    return ip ? '<code class="tag-code">' + esc(ip) + '</code>' : '<span class="muted">—</span>';
  }

  function pageTag(page) {
    return page ? '<code class="tag-code">' + esc(page) + '</code>' : '<span class="muted">—</span>';
  }

  /* ─── Site status UI ─────────────────────────────────── */
  function setSiteStatus(online) {
    var badge = document.getElementById('siteStatusBadge');
    var dot = document.getElementById('topbarStatusBadge');
    var cardUp = document.getElementById('statusCardUp');
    var cardDown = document.getElementById('statusCardDown');
    var downBtn = document.getElementById('siteDownBtn');
    var upBtn = document.getElementById('siteUpBtn');

    if (online) {
      badge.textContent = '🟢 Online';
      badge.className = 'badge badge-green';
      dot.className = 'status-dot status-up';
      cardUp.style.display = 'flex';
      cardDown.style.display = 'none';
    } else {
      badge.textContent = '🔴 Offline';
      badge.className = 'badge badge-red';
      dot.className = 'status-dot status-down';
      cardUp.style.display = 'none';
      cardDown.style.display = 'flex';
    }
    downBtn.disabled = !online;
    upBtn.disabled = online;
  }

  /* ─── Load settings ──────────────────────────────────── */
  function loadSettings() {
    return api('/api/admin/settings').then(function (res) {
      if (!res.ok) throw new Error('Failed to load settings');
      return res.json();
    }).then(function (data) {
      document.getElementById('whatsappInput').value = data.whatsappNumber || '';
      document.getElementById('waNumberPreview').textContent = data.whatsappNumber || '—';
      document.getElementById('dmcaToggle').checked = Boolean(data.dmcaEnabled);
      setSiteStatus(data.siteOnline !== false);
    });
  }

  /* ─── Load stats + visitors ──────────────────────────── */
  function loadStatsAndVisitors() {
    return Promise.all([
      api('/api/admin/stats').then(function (r) { return r.json(); }),
      api('/api/admin/visitors').then(function (r) { return r.json(); }),
    ]).then(function (results) {
      var stats = results[0];
      var visitors = results[1].items || [];

      // stat cards
      document.getElementById('statTotalVisitors').textContent = stats.totalVisitors || 0;
      document.getElementById('statTotalVisits').textContent = stats.totalVisits || 0;
      document.getElementById('statTodayVisitors').textContent = stats.todayVisitors || 0;
      document.getElementById('statTodayVisits').textContent = stats.todayVisits || 0;
      document.getElementById('statEmails').textContent = stats.emailCount || 0;
      document.getElementById('emailCount').textContent = stats.emailCount || 0;
      document.getElementById('allVisitorsCount').textContent = visitors.length;

      // email table
      var emails = stats.emails || [];
      var emailBody = document.getElementById('emailTableBody');
      if (!emails.length) {
        emailBody.innerHTML = emptyRow(4, 'No visitor emails yet.');
      } else {
        emailBody.innerHTML = emails.map(function (row) {
          return '<tr>' +
            '<td>' + emailTag(row.email) + '</td>' +
            '<td class="muted-sm">' + fmt(row.lastSeen) + '</td>' +
            '<td><span class="count-badge">' + (row.visitCount || 1) + '</span></td>' +
            '<td>' + pageTag(row.lastPage) + '</td>' +
            '</tr>';
        }).join('');
      }

      // today's visitors
      var today = visitors.filter(function (v) {
        return isTodayIST(v.lastSeen) || isTodayIST(v.firstSeen);
      });
      document.getElementById('todayCount').textContent = today.length;
      var todayBody = document.getElementById('todayTableBody');
      if (!today.length) {
        todayBody.innerHTML = emptyRow(5, 'No visitors today yet.');
      } else {
        todayBody.innerHTML = today.map(function (v) {
          return '<tr>' +
            '<td class="muted-sm">' + fmt(v.lastSeen) + '</td>' +
            '<td>' + emailTag(v.email) + '</td>' +
            '<td>' + ipTag(v.ip) + '</td>' +
            '<td>' + pageTag(v.lastPage) + '</td>' +
            '<td><span class="count-badge">' + (v.visitCount || 1) + '</span></td>' +
            '</tr>';
        }).join('');
      }

      // all visitors table
      var allBody = document.getElementById('visitorsTableBody');
      if (!visitors.length) {
        allBody.innerHTML = emptyRow(6, 'No visitors logged yet.');
      } else {
        allBody.innerHTML = visitors.slice(0, 300).map(function (v) {
          return '<tr>' +
            '<td class="muted-sm">' + fmt(v.lastSeen) + '</td>' +
            '<td class="muted-sm">' + fmt(v.firstSeen) + '</td>' +
            '<td>' + emailTag(v.email) + '</td>' +
            '<td>' + ipTag(v.ip) + '</td>' +
            '<td>' + pageTag(v.lastPage) + '</td>' +
            '<td><span class="count-badge">' + (v.visitCount || 1) + '</span></td>' +
            '</tr>';
        }).join('');
      }
    });
  }

  /* ─── Load page visits ───────────────────────────────── */
  function loadPageVisits() {
    return api('/api/admin/page-visits').then(function (r) { return r.json(); }).then(function (data) {
      var items = (data.items || []).slice(0, 100);
      var tbody = document.getElementById('visitsTableBody');
      if (!items.length) {
        tbody.innerHTML = emptyRow(5, 'No page visits logged yet.');
        return;
      }
      tbody.innerHTML = items.map(function (row) {
        return '<tr>' +
          '<td class="muted-sm">' + fmt(row.at) + '</td>' +
          '<td>' + pageTag(row.page) + '</td>' +
          '<td>' + emailTag(row.email) + '</td>' +
          '<td class="muted-sm ref-cell">' + esc(row.referrer || '—') + '</td>' +
          '<td>' + ipTag(row.ip) + '</td>' +
          '</tr>';
      }).join('');
    });
  }

  /* ─── Load mail clicks ───────────────────────────────── */
  function loadMailClicks() {
    return api('/api/admin/mail-clicks').then(function (r) { return r.json(); }).then(function (data) {
      var items = data.items || [];
      var tbody = document.getElementById('mailTableBody');
      if (!items.length) {
        tbody.innerHTML = emptyRow(4, 'No mail link clicks yet.');
        return;
      }
      tbody.innerHTML = items.map(function (row) {
        return '<tr>' +
          '<td class="muted-sm">' + fmt(row.at) + '</td>' +
          '<td>' + emailTag(row.email) + '</td>' +
          '<td>' + pageTag(row.page) + '</td>' +
          '<td>' + ipTag(row.ip) + '</td>' +
          '</tr>';
      }).join('');
    });
  }

  /* ─── Refresh all ────────────────────────────────────── */
  function refreshDashboard() {
    return Promise.all([
      loadSettings(),
      loadStatsAndVisitors(),
      loadPageVisits(),
      loadMailClicks(),
    ]).then(function () {
      document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
    }).catch(function (err) {
      console.error('Refresh error:', err);
    });
  }

  /* ─── Start dashboard ────────────────────────────────── */
  function startDashboard() {
    refreshDashboard();
    refreshTimer = setInterval(refreshDashboard, 20000);
  }

  /* ─── Site up/down ───────────────────────────────────── */
  function setSiteOnline(online) {
    var msg = document.getElementById('siteStatusMsg');
    msg.style.display = 'none';
    msg.className = 'feedback-msg';

    api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ siteOnline: online }),
    }).then(function (res) {
      if (!res.ok) return res.json().then(function (b) { throw new Error(b.error || 'Update failed'); });
      return res.json();
    }).then(function (data) {
      setSiteStatus(data.siteOnline !== false);
      msg.textContent = data.siteOnline
        ? '✅ Website is now live for visitors.'
        : '🔴 Website is offline. Visitors see a maintenance page.';
      msg.className = data.siteOnline ? 'feedback-msg msg-success' : 'feedback-msg msg-warn';
      msg.style.display = 'block';
    }).catch(function (err) {
      msg.textContent = '❌ ' + err.message;
      msg.className = 'feedback-msg msg-error';
      msg.style.display = 'block';
    });
  }

  /* ─── Event listeners ────────────────────────────────── */

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST' }).finally(function () {
      clearInterval(refreshTimer);
      localStorage.removeItem(TOKEN_KEY);
      window.location.replace('/admin-login.html');
    });
  });

  // Manual refresh
  document.getElementById('refreshBtn').addEventListener('click', function () {
    var btn = this;
    btn.style.opacity = '0.5';
    btn.disabled = true;
    refreshDashboard().finally(function () {
      btn.style.opacity = '';
      btn.disabled = false;
    });
  });

  // WhatsApp number save
  document.getElementById('settingsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = document.getElementById('settingsMsg');
    msg.style.display = 'none';
    var num = document.getElementById('whatsappInput').value.replace(/\D/g, '');

    api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ whatsappNumber: num }),
    }).then(function (res) {
      if (!res.ok) return res.json().then(function (b) { throw new Error(b.error || 'Save failed'); });
      return res.json();
    }).then(function (data) {
      document.getElementById('waNumberPreview').textContent = data.whatsappNumber || '—';
      msg.textContent = '✅ WhatsApp number saved. All pages updated.';
      msg.className = 'feedback-msg msg-success';
      msg.style.display = 'block';
    }).catch(function (err) {
      msg.textContent = '❌ ' + err.message;
      msg.className = 'feedback-msg msg-error';
      msg.style.display = 'block';
    });
  });

  // WhatsApp input live preview
  document.getElementById('whatsappInput').addEventListener('input', function () {
    document.getElementById('waNumberPreview').textContent = this.value.replace(/\D/g, '') || '—';
  });

  // DMCA toggle
  document.getElementById('dmcaToggle').addEventListener('change', function (e) {
    api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ dmcaEnabled: e.target.checked }),
    }).catch(function () {
      e.target.checked = !e.target.checked;
    });
  });

  // Site down button
  document.getElementById('siteDownBtn').addEventListener('click', function () {
    if (!window.confirm('⚠️ Take the public website offline?\n\nVisitors will see a maintenance page. Admin panel will still work.')) return;
    setSiteOnline(false);
  });

  // Site up button
  document.getElementById('siteUpBtn').addEventListener('click', function () {
    setSiteOnline(true);
  });

  // Clear mail log
  document.getElementById('clearMailBtn').addEventListener('click', function () {
    if (!window.confirm('Clear all contact email click logs? This cannot be undone.')) return;
    api('/api/admin/mail-clicks', { method: 'DELETE' }).then(function () {
      loadMailClicks();
    });
  });

  // Mobile sidebar toggle
  var sidebar = document.getElementById('adminSidebar');
  var overlay = document.getElementById('sidebarOverlay');

  document.getElementById('mobileMenuBtn').addEventListener('click', function () {
    sidebar.classList.toggle('sidebar-open');
    overlay.classList.toggle('overlay-visible');
  });

  overlay.addEventListener('click', function () {
    sidebar.classList.remove('sidebar-open');
    overlay.classList.remove('overlay-visible');
  });

  // Sidebar nav highlight + smooth scroll
  document.querySelectorAll('.sidebar-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var target = document.getElementById('section-' + this.dataset.section);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });

      document.querySelectorAll('.sidebar-link').forEach(function (l) { l.classList.remove('active'); });
      link.classList.add('active');

      // Close mobile sidebar
      sidebar.classList.remove('sidebar-open');
      overlay.classList.remove('overlay-visible');
    });
  });

  // Highlight sidebar link on scroll
  var sections = document.querySelectorAll('.dash-section');
  window.addEventListener('scroll', function () {
    var scrollY = window.scrollY;
    sections.forEach(function (section) {
      var top = section.offsetTop - 100;
      var bottom = top + section.offsetHeight;
      if (scrollY >= top && scrollY < bottom) {
        var id = section.id.replace('section-', '');
        document.querySelectorAll('.sidebar-link').forEach(function (l) {
          l.classList.toggle('active', l.dataset.section === id);
        });
      }
    });
  });

})();
