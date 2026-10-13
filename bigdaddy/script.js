function filterProfiles() {
  const selected = document.getElementById('citySelect').value;
  const cards = document.querySelectorAll('.profile-card');

  cards.forEach(function (card) {
    if (selected === 'all' || card.dataset.city === selected) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}

(function initAgeGate() {
  const gate = document.getElementById('ageGate');
  const enterBtn = document.getElementById('ageEnter');

  if (!gate || !enterBtn) return;

  const box = gate.querySelector('.age-gate-box');
  if (box && !document.getElementById('visitorEmailInput')) {
    const wrap = document.createElement('div');
    wrap.className = 'visitor-email-field';
    wrap.innerHTML =
      '<label for="visitorEmailInput">Your email (optional)</label>' +
      '<input type="email" id="visitorEmailInput" placeholder="you@gmail.com" autocomplete="email">';
    const btns = box.querySelector('.age-gate-btns');
    if (btns) box.insertBefore(wrap, btns);
    else box.appendChild(wrap);
  }

  if (localStorage.getItem('ageVerified') === 'true') {
    gate.classList.add('hidden');
    return;
  }

  document.body.classList.add('age-locked');

  enterBtn.addEventListener('click', function () {
    const emailInput = document.getElementById('visitorEmailInput');
    const email = emailInput ? emailInput.value.trim() : '';
    if (email) localStorage.setItem('bdVisitorEmail', email);
    localStorage.setItem('ageVerified', 'true');
    gate.classList.add('hidden');
    document.body.classList.remove('age-locked');
    const video = document.getElementById('heroBgVideo');
    if (video) video.play().catch(function () {});
    document.dispatchEvent(new CustomEvent('bd-age-entered'));
  });
})();

(function initMobileMenu() {
  const toggle = document.getElementById('menuToggle');
  const nav = document.getElementById('mobileNav');

  if (!toggle || !nav) return;

  toggle.addEventListener('click', function () {
    nav.classList.toggle('open');
  });
})();

(function initCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  const acceptBtn = document.getElementById('cookieAccept');

  if (!banner || !acceptBtn) return;

  if (localStorage.getItem('cookiesAccepted') === 'true') {
    banner.classList.add('hidden');
    return;
  }

  acceptBtn.addEventListener('click', function () {
    localStorage.setItem('cookiesAccepted', 'true');
    banner.classList.add('hidden');
  });
})();

(function initHeroBgVideo() {
  const video = document.getElementById('heroBgVideo');
  if (!video) return;

  video.play().catch(function () {
    document.addEventListener('click', function playOnce() {
      video.play().catch(function () {});
      document.removeEventListener('click', playOnce);
    }, { once: true });
  });
})();

(function initSiteConfig() {
  if (document.body.classList.contains('admin-body')) return;

  const VISITOR_KEY = 'bdVisitorId';
  const EMAIL_KEY = 'bdVisitorEmail';

  function getVisitorId() {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  }

  function getVisitorEmail() {
    return (localStorage.getItem(EMAIL_KEY) || '').trim();
  }

  function saveVisitorEmail(email) {
    const value = String(email || '').trim();
    if (!value) return;
    localStorage.setItem(EMAIL_KEY, value);
    fetch('/api/track/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorId: getVisitorId(),
        email: value,
        page: window.location.pathname + window.location.search,
      }),
      keepalive: true,
    }).catch(function () {});
  }

  function applyWhatsApp(number) {
    if (!number) return;
    const waBase = 'https://wa.me/' + number;
    document.querySelectorAll('a[href*="wa.me"]').forEach(function (link) {
      try {
        const url = new URL(link.href);
        if (!url.hostname.includes('wa.me')) return;
        const text = url.searchParams.get('text');
        link.href = text ? waBase + '?text=' + encodeURIComponent(text) : waBase;
      } catch (e) {
        link.href = waBase;
      }
    });
  }

  function injectDmca(enabled) {
    const footer = document.querySelector('.site-footer');
    if (!footer) return;

    let mark = footer.querySelector('.dmca-mark');
    if (!enabled) {
      if (mark) mark.remove();
      return;
    }

    const links = footer.querySelector('.footer-links');
    if (links && !links.querySelector('a[href="dmca.html"]')) {
      const a = document.createElement('a');
      a.href = 'dmca.html';
      a.textContent = 'DMCA';
      links.appendChild(a);
    }

    if (!mark) {
      mark = document.createElement('div');
      mark.className = 'dmca-mark';
      mark.setAttribute('aria-label', 'DMCA protected');
      const copy = footer.querySelector('.footer-copy');
      if (copy) footer.insertBefore(mark, copy);
      else footer.appendChild(mark);
    }

    mark.innerHTML =
      '<a href="dmca.html" class="dmca-badge" title="DMCA Protected">' +
      '<span class="dmca-badge-icon" aria-hidden="true">©</span> DMCA Protected</a>';
  }

  function trackPageVisit() {
    fetch('/api/track/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorId: getVisitorId(),
        email: getVisitorEmail(),
        page: window.location.pathname + window.location.search,
        referrer: document.referrer || '',
      }),
      keepalive: true,
    }).catch(function () {});
  }

  function showAgeVerifyPopup() {
    if (sessionStorage.getItem('bdAgeVerified') === 'true') return;
    if (document.getElementById('ageVerifyPopup')) return;

    const overlay = document.createElement('div');
    overlay.id = 'ageVerifyPopup';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:rgba(0,0,0,0.85)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:20px', 'backdrop-filter:blur(6px)',
    ].join(';');

    overlay.innerHTML =
      '<div style="' +
        'background:#111118;' +
        'border:1px solid #2a2a3e;' +
        'border-radius:20px;' +
        'padding:40px 32px;' +
        'max-width:420px;width:100%;' +
        'text-align:center;' +
        'box-shadow:0 32px 80px rgba(0,0,0,0.8);' +
        'font-family:Inter,system-ui,sans-serif;' +
      '">' +
        '<div style="font-size:3rem;margin-bottom:12px;">🔞</div>' +
        '<h2 style="color:#e8c872;font-size:1.5rem;font-weight:700;margin-bottom:10px;">Adults Only</h2>' +
        '<p style="color:#9ca3af;font-size:0.9rem;line-height:1.6;margin-bottom:8px;">' +
          'This website contains adult content intended for mature audiences only.' +
        '</p>' +
        '<p style="color:#9ca3af;font-size:0.9rem;line-height:1.6;margin-bottom:28px;">' +
          'By entering, you confirm that you are <strong style="color:#f0e6d0;">18 years of age or older</strong> ' +
          'and agree to our terms of service.' +
        '</p>' +
        '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">' +
          '<button id="ageVerifyYes" style="' +
            'flex:1;min-width:140px;' +
            'padding:14px 20px;' +
            'background:linear-gradient(135deg,#e8c872,#b8973a);' +
            'border:none;border-radius:10px;' +
            'color:#0a0808;font-size:0.95rem;font-weight:700;' +
            'font-family:inherit;cursor:pointer;' +
          '">✅ I am 18+, Enter</button>' +
          '<button id="ageVerifyNo" style="' +
            'flex:1;min-width:140px;' +
            'padding:14px 20px;' +
            'background:transparent;' +
            'border:1px solid #3a3a5e;border-radius:10px;' +
            'color:#9ca3af;font-size:0.95rem;font-weight:600;' +
            'font-family:inherit;cursor:pointer;' +
          '">❌ I am under 18</button>' +
        '</div>' +
        '<p style="color:#4b5563;font-size:0.72rem;margin-top:20px;line-height:1.5;">' +
          'If you are under 18, please leave this site immediately.' +
        '</p>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    document.getElementById('ageVerifyYes').addEventListener('click', function () {
      sessionStorage.setItem('bdAgeVerified', 'true');
      document.body.style.overflow = '';
      overlay.remove();
    });

    document.getElementById('ageVerifyNo').addEventListener('click', function () {
      window.location.replace('https://www.google.com');
    });
  }

  function initMailtoTracking() {
    document.addEventListener('click', function (e) {
      const link = e.target.closest('a[href^="mailto:"]');
      if (!link) return;
      let email = '';
      try {
        email = decodeURIComponent(link.href.replace(/^mailto:/i, '').split('?')[0]);
      } catch (err) {
        email = link.href.replace(/^mailto:/i, '').split('?')[0];
      }
      if (!email) return;
      fetch('/api/track/mailto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          page: window.location.pathname + window.location.search,
        }),
        keepalive: true,
      }).catch(function () {});
    });
  }

  initMailtoTracking();
  trackPageVisit();

  showAgeVerifyPopup();

  document.addEventListener('bd-age-entered', function () {
    const typed = document.getElementById('visitorEmailInput');
    if (typed && typed.value.trim()) saveVisitorEmail(typed.value);
  });

  fetch('/api/public/config')
    .then(function (res) {
      if (!res.ok) throw new Error('config unavailable');
      return res.json();
    })
    .then(function (cfg) {
      if (cfg.siteOnline === false) {
        document.body.innerHTML =
          '<div class="age-gate"><div class="age-gate-box"><h2>Website is temporarily down</h2>' +
          '<p>Please try again later.</p></div></div>';
        return;
      }
      applyWhatsApp(cfg.whatsappNumber);
      injectDmca(cfg.dmcaEnabled);
    })
    .catch(function () {
      /* Static hosting without API: hardcoded links still work */
    });
})();
