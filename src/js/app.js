/**
 * AeroX Sports — app.js
 * Main application controller for the AeroX Sports streaming platform.
 * © 2025 AeroX Studio / InfinityForge
 */
(function () {
  'use strict';

  /* ===================================================================
   * Constants
   * =================================================================== */

  var API_BASE = 'https://streamed.pk';
  var CACHE_TTL = 60000;
  var FALLBACK_TIMEOUT = 8000;
  var PING_TIMEOUT = 3000;
  var PRESENCE_INTERVAL = 15000;
  var PRESENCE_STREAMING_INTERVAL = 45000;

  /* ===================================================================
   * Utility helpers
   * =================================================================== */

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.from((c || document).querySelectorAll(s)); };

  /** HTML‑escape any user‑supplied string. */
  function esc(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Zero‑pad a number for countdown display. */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* ===================================================================
   * API layer — cached fetch with error handling
   * =================================================================== */

  var cache = {};

  function api(url) {
    var cached = cache[url];
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return Promise.resolve(cached.data);
    }
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('API ' + res.status);
      return res.json();
    }).then(function (data) {
      cache[url] = { data: data, ts: Date.now() };
      return data;
    });
  }

  /* ===================================================================
   * URL builders
   * =================================================================== */

  function badgeUrl(id) {
    return id ? API_BASE + '/api/images/badge/' + id + '.webp' : '';
  }

  function posterUrl(path) {
    return path ? API_BASE + path : '';
  }

  /* ===================================================================
   * Sport emoji map
   * =================================================================== */

  var EMOJI = {
    football:           '\u26BD',
    basketball:         '\uD83C\uDFC0',
    tennis:             '\uD83C\uDFBE',
    fight:              '\uD83E\uDD4A',
    'motor-sports':     '\uD83C\uDFCE\uFE0F',
    hockey:             '\uD83C\uDFD2',
    baseball:           '\u26BE',
    rugby:              '\uD83C\uDFC9',
    cricket:            '\uD83C\uDFCF',
    golf:               '\u26F3',
    'american-football': '\uD83C\uDFC8',
    afl:                '\uD83C\uDFC9',
    billiards:          '\uD83C\uDFB1',
    darts:              '\uD83C\uDFAF',
    other:              '\uD83C\uDFC5'
  };

  function sportEmoji(id) { return EMOJI[id] || '\uD83C\uDFC5'; }

  /* ===================================================================
   * Match helpers
   * =================================================================== */

  /** Returns true if the match started within the last 2 hours. */
  function isLive(match) {
    var now = Date.now();
    return match.date > 0 && match.date <= now && match.date > now - 7200000;
  }

  /** Normalize a raw match object with safe defaults. */
  function safeMatch(m) {
    if (!m) return {};
    return {
      id:       m.id || '',
      title:    m.title || '',
      category: m.category || 'other',
      date:     typeof m.date === 'number' ? m.date : 0,
      poster:   m.poster || '',
      popular:  !!m.popular,
      teams:    m.teams || null,
      sources:  Array.isArray(m.sources) ? m.sources : []
    };
  }

  /** Check if any source in a match is flagged HD. */
  function hasHdSource(m) {
    if (!m.sources) return false;
    for (var i = 0; i < m.sources.length; i++) {
      if (m.sources[i].hd) return true;
    }
    return false;
  }

  /* ===================================================================
   * DOM references
   * =================================================================== */

  var DOM = {};

  function initDom() {
    var ids = [
      'navbar', 'navPills', 'navMobilePills', 'navHamburger', 'navMobileMenu',
      'liveCountText', 'streamViewers',
      'liveSection', 'liveGrid', 'liveCount',
      'todaySection', 'todayGrid',
      'browseSection', 'browseGrid', 'sportPills',
      'popularSection', 'popularScroll',
      'heroWatchBtn', 'heroScheduleBtn',
      'statLive', 'statEvents', 'statSports',
      'searchToggle', 'searchOverlay', 'searchBackdrop',
      'searchInput', 'searchResults', 'searchClear',
      'playerModal', 'modalIframe', 'modalTitle',
      'modalStreams', 'modalInfo', 'modalClose',
      'modalProgress', 'modalProgressBar', 'connectionQuality',
      'toastContainer', 'popularToggle', 'browsePopularToggle',
      'liveCounterBtn', 'navTrafficCount', 'serverAnalyzerOverlay', 'analyzerStatus', 'analyzerSub'
    ];
    for (var i = 0; i < ids.length; i++) {
      DOM[ids[i]] = $('#' + ids[i]);
      if (!DOM[ids[i]]) console.warn('[AeroX] Missing element:', ids[i]);
    }
  }

  /* ===================================================================
   * Application state
   * =================================================================== */

  var state = {
    sports:          [],
    liveMatches:     [],
    todayMatches:    [],
    popularMatches:  [],
    browseMatches:   [],
    currentSport:    'football',
    allMatches:      [],
    browseMode:      'all',
    streamLatencies: {},
    recommendedIndex: 0,
    prefetchCache:   {},
    sessionId:       null,
    onlineCount:     0,
    streamViewersCount: {}
  };

  /* ===================================================================
   * Real-Time Visitor Presence System (kvdb.io + simulator fallback)
   * =================================================================== */

  var presenceInterval = null;
  var BUCKET_URL = 'https://kvdb.io/Ej2Ckaef8trc4x65SsVrJj/';
  var isStreamingActive = false;
  var tabHidden = false;
  var presenceTick = 0;

  function initPresence() {
    updatePresence({ fetchStats: true });
    schedulePresenceInterval();
  }

  function schedulePresenceInterval() {
    if (presenceInterval) clearInterval(presenceInterval);
    if (tabHidden) return;
    var interval = isStreamingActive ? PRESENCE_STREAMING_INTERVAL : PRESENCE_INTERVAL;
    presenceInterval = setInterval(function () {
      presenceTick++;
      updatePresence({
        fetchStats: !isStreamingActive || presenceTick % 3 === 0
      });
    }, interval);
  }

  function updatePresence(options) {
    options = options || {};
    var fetchStats = options.fetchStats !== false;
    var now = Date.now();
    var payload = {
      t: now,
      status: currentMatch ? 'Watching' : 'Browsing',
      matchId: currentMatch ? currentMatch.id : '',
      matchTitle: currentMatch ? currentMatch.title : '',
      server: (currentMatch && currentStreams[activeStreamIndex]) ? (currentStreams[activeStreamIndex].source + ' ' + (currentStreams[activeStreamIndex].language || '')) : ''
    };

    if (state.sessionId) {
      fetch(BUCKET_URL + 'online_' + state.sessionId, {
        method: 'POST',
        body: JSON.stringify(payload),
        mode: 'cors'
      }).catch(function () {});
    }

    if (!fetchStats) return;

    fetch(BUCKET_URL + '?values=true&format=json', { mode: 'cors' })
      .then(function (res) {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(function (data) {
        var onlineUsers = {};
        var streamWatchers = {};

        if (Array.isArray(data)) {
          for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var key = item[0];
            var valStr = item[1];

            if (key.indexOf('online_') === 0) {
              var sessId = key.substring(7);
              try {
                var p = JSON.parse(valStr);
                // Filter out entries older than 45 seconds
                if (now - p.t > 45000) continue;

                onlineUsers[sessId] = true;
                if (p.matchId) {
                  streamWatchers[p.matchId] = (streamWatchers[p.matchId] || 0) + 1;
                }
              } catch (e) {
                // Backward compatibility for raw timestamps
                var ts = parseInt(valStr, 10) || 0;
                if (now - ts <= 45000) {
                  onlineUsers[sessId] = true;
                }
              }
            }
          }
        }

        var onlineCount = Object.keys(onlineUsers).length;
        if (onlineCount === 0) onlineCount = 1;

        state.onlineCount = onlineCount;
        state.streamViewersCount = streamWatchers;

        updateTrafficUI();
      })
      .catch(function () {
        runSimulatedPresence();
      });
  }

  function runSimulatedPresence() {
    state.onlineCount = 1;
    state.streamViewersCount = {};
    if (currentMatch) {
      state.streamViewersCount[currentMatch.id] = 1;
    }
    updateTrafficUI();
  }

  function updateTrafficUI() {
    if (DOM.navTrafficCount) {
      DOM.navTrafficCount.textContent = state.onlineCount;
    }

    if (currentMatch && DOM.streamViewers) {
      var count = state.streamViewersCount[currentMatch.id] || 1;
      if (isStreamingActive) {
        DOM.streamViewers.innerHTML =
          '<span class="viewers-dot"></span><span class="viewers-num">' + count.toLocaleString() + '</span> watching';
      } else {
        animateCounterNum(count, function (val) {
          if (DOM.streamViewers) {
            var numEl = DOM.streamViewers.querySelector('.viewers-num');
            if (numEl) {
              numEl.textContent = val.toLocaleString();
            } else {
              DOM.streamViewers.innerHTML =
                '<span class="viewers-dot"></span><span class="viewers-num">' + val.toLocaleString() + '</span> watching';
            }
          }
        });
      }
      DOM.streamViewers.classList.add('visible');
    }
  }

  function startStreamViewers(match) {
    if (!match) return;
    updatePresence();
  }

  function stopStreamViewers() {
    updatePresence();
    if (DOM.streamViewers) {
      DOM.streamViewers.classList.remove('visible');
      DOM.streamViewers.innerHTML = '';
    }
  }

  /* Lightweight number tween used by the viewer counter. */
  function animateCounterNum(target, onTick) {
    var numEl = DOM.streamViewers ? DOM.streamViewers.querySelector('.viewers-num') : null;
    var start = numEl ? (parseInt(numEl.textContent.replace(/,/g, ''), 10) || 0) : 0;
    var diff = target - start;
    var startTime = 0;
    function tick(now) {
      if (!startTime) startTime = now;
      var p = Math.min((now - startTime) / 700, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      onTick(Math.round(start + diff * eased));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ===================================================================
   * Stream prefetch — warm cache on card hover
   * =================================================================== */

  function prefetchStreams(match) {
    if (!match || !match.id || isStreamingActive || tabHidden) return;
    var cached = state.prefetchCache[match.id];
    if (cached && (cached.ready || cached.loading)) return;

    var sources = match.sources || [];
    if (sources.length === 0) return;

    state.prefetchCache[match.id] = { loading: true };

    var fetches = sources.map(function (s) {
      return api(API_BASE + '/api/stream/' + s.source + '/' + s.id + '?_=' + Date.now());
    });

    Promise.allSettled(fetches).then(function (results) {
      var streams = [];
      var seen = {};
      for (var i = 0; i < results.length; i++) {
        if (results[i].status !== 'fulfilled' || !results[i].value) continue;
        var arr = results[i].value;
        for (var j = 0; j < arr.length; j++) {
          var s = arr[j];
          var key = s.embedUrl || (s.source + '|' + s.language);
          if (!seen[key]) {
            seen[key] = true;
            streams.push(s);
          }
        }
      }
      if (streams.length === 0) {
        delete state.prefetchCache[match.id];
        return;
      }
      state.prefetchCache[match.id] = { loading: false, ready: true, streams: streams };
    }).catch(function () {
      delete state.prefetchCache[match.id];
    });
  }

  function collectStreamsFromResults(results) {
    var streams = [];
    var seen = {};
    for (var i = 0; i < results.length; i++) {
      if (results[i].status !== 'fulfilled' || !results[i].value) continue;
      var arr = results[i].value;
      for (var j = 0; j < arr.length; j++) {
        var s = arr[j];
        var key = s.embedUrl || (s.source + '|' + s.language);
        if (!seen[key]) {
          seen[key] = true;
          streams.push(s);
        }
      }
    }
    return streams;
  }

  function applyRankedStreams(ranked) {
    if (ranked.length > 0) {
      var reordered = ranked.map(function (r) { return currentStreams[r.index]; });
      currentStreams = reordered;
      state.recommendedIndex = 0;
      activeStreamIndex = 0;

      var newLatencies = {};
      ranked.forEach(function (r, newIdx) {
        newLatencies[newIdx] = state.streamLatencies[r.index] || r.latency;
      });
      state.streamLatencies = newLatencies;
    }
  }

  function finalizeStreamSelection() {
    var recommendedStream = currentStreams[0];
    var latency = state.streamLatencies[0] || '100';
    if (DOM.analyzerStatus) DOM.analyzerStatus.textContent = 'Optimal server detected!';
    if (DOM.analyzerSub) {
      DOM.analyzerSub.textContent = 'Auto-connecting to ' + (recommendedStream ? (recommendedStream.source || 'Server') : 'Server') + ' (' + latency + 'ms)...';
    }

    var anyHd = false;
    for (var k = 0; k < currentStreams.length; k++) {
      if (currentStreams[k].hd) { anyHd = true; break; }
    }
    if (DOM.modalInfo) {
      var qBar = anyHd
        ? '<span class="quality-badge quality-4k" style="margin-left:auto">Streaming in 4K Ultra HD</span>'
        : '<span class="quality-badge quality-hd" style="margin-left:auto">Streaming in HD</span>';
      DOM.modalInfo.innerHTML += qBar;
    }

    renderStreamPills();
    loadStream(activeStreamIndex, true);
  }

  /* ===================================================================
   * Smart server detection — ping-race embed URLs
   * =================================================================== */

  function pingUrl(url, timeout) {
    timeout = timeout || PING_TIMEOUT;
    return new Promise(function (resolve) {
      if (!url) {
        resolve({ latency: timeout, ok: false });
        return;
      }
      var start = performance.now();
      var timer = setTimeout(function () {
        resolve({ latency: timeout, ok: false });
      }, timeout);

      fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' })
        .then(function () {
          clearTimeout(timer);
          resolve({ latency: Math.round(performance.now() - start), ok: true });
        })
        .catch(function () {
          clearTimeout(timer);
          resolve({ latency: Math.round(performance.now() - start), ok: false });
        });
    });
  }

  function rankStreamsByLatency(streams) {
    var pings = streams.map(function (s, i) {
      return pingUrl(s.embedUrl, PING_TIMEOUT).then(function (result) {
        state.streamLatencies[i] = result.latency;
        return { index: i, latency: result.latency, ok: result.ok };
      });
    });

    return Promise.all(pings).then(function (results) {
      results.sort(function (a, b) {
        if (a.ok !== b.ok) return a.ok ? -1 : 1;
        return a.latency - b.latency;
      });
      return results;
    });
  }

  function getConnectionQuality(latency) {
    if (latency <= 300)  return { label: 'Excellent', cls: 'excellent' };
    if (latency <= 800)  return { label: 'Good',      cls: 'good' };
    return { label: 'Fair', cls: 'fair' };
  }

  function showConnectionQuality(latency) {
    if (!DOM.connectionQuality) return;
    var q = getConnectionQuality(latency);
    DOM.connectionQuality.textContent = q.label;
    DOM.connectionQuality.className = 'connection-quality visible ' + q.cls;
  }

  function hideConnectionQuality() {
    if (!DOM.connectionQuality) {
      return;
    }
    DOM.connectionQuality.className = 'connection-quality';
    DOM.connectionQuality.textContent = '';
  }

  /* ===================================================================
   * Progress bar — slim non-blocking loader
   * =================================================================== */

  var progressTimer = null;

  function showProgress() {
    if (!DOM.modalProgress || !DOM.modalProgressBar) return;
    DOM.modalProgress.classList.add('active');
    DOM.modalProgressBar.classList.remove('done');
    DOM.modalProgressBar.style.width = '0%';

    var progress = 0;
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(function () {
      progress = Math.min(progress + Math.random() * 12, 85);
      DOM.modalProgressBar.style.width = progress + '%';
    }, 200);
  }

  function hideProgress() {
    if (!DOM.modalProgress || !DOM.modalProgressBar) return;
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    DOM.modalProgressBar.style.width = '100%';
    DOM.modalProgressBar.classList.add('done');
    setTimeout(function () {
      if (DOM.modalProgress) DOM.modalProgress.classList.remove('active');
      if (DOM.modalProgressBar) {
        DOM.modalProgressBar.classList.remove('done');
        DOM.modalProgressBar.style.width = '0%';
      }
    }, 400);
  }

  function skeletonGrid(n) {
    n = n || 8;
    var h = '<div class="skel-grid">';
    for (var i = 0; i < n; i++) h += '<div class="skeleton shimmer"></div>';
    return h + '</div>';
  }

  function skeletonHScroll(n) {
    n = n || 5;
    var h = '<div class="skel-row">';
    for (var i = 0; i < n; i++) h += '<div class="skeleton shimmer"></div>';
    return h + '</div>';
  }

  /* ===================================================================
   * Card HTML generators
   * =================================================================== */

  /** Main match card used in live / today / browse grids. */
  function cardHtml(m) {
    m = safeMatch(m);

    var live   = isLive(m);
    var ended  = m.date > 0 && m.date < Date.now() - 7200000;
    var future = m.date > Date.now();
    var hasTeams = m.teams && m.teams.home && m.teams.away;
    var poster   = m.poster ? posterUrl(m.poster) : '';
    var hd       = hasHdSource(m);

    // Teams or title block
    var body = '';
    if (hasTeams) {
      var hb = m.teams.home.badge ? badgeUrl(m.teams.home.badge) : '';
      var ab = m.teams.away.badge ? badgeUrl(m.teams.away.badge) : '';
      body =
          '<div class="match-teams">'
        +   '<div class="match-team">'
        +     '<img class="match-team-badge" src="' + hb + '" alt="' + esc(m.teams.home.name) + '" width="48" height="48" loading="lazy" onerror="this.onerror=null;this.src=\'src/img/placeholder-badge.svg\'">'
        +     '<span class="match-team-name">' + esc(m.teams.home.name) + '</span>'
        +   '</div>'
        +   '<span class="match-vs">VS</span>'
        +   '<div class="match-team">'
        +     '<img class="match-team-badge" src="' + ab + '" alt="' + esc(m.teams.away.name) + '" width="48" height="48" loading="lazy" onerror="this.onerror=null;this.src=\'src/img/placeholder-badge.svg\'">'
        +     '<span class="match-team-name">' + esc(m.teams.away.name) + '</span>'
        +   '</div>'
        + '</div>';
    } else {
      body = '<div class="match-title">' + esc(m.title) + '</div>';
    }

    // Status badge
    var badge = '';
    if (live)         badge = '<span class="match-badge live"><span class="pulse"></span>LIVE</span>';
    else if (ended)   badge = '<span class="match-badge ended">ENDED</span>';
    else if (future)  badge = '<span class="match-badge countdown" data-countdown="' + m.date + '">--:--:--</span>';
    else if (m.date === 0) badge = '<span class="match-badge live">ON AIR</span>';

    // Stream count
    var sc = m.sources.length;
    var streams = '<span class="match-streams">' + sc + ' stream' + (sc !== 1 ? 's' : '') + ' available</span>';

    // Quality indicator — prominent badge
    var quality = '';
    if (hd) {
      quality = '<span class="quality-badge quality-4k">4K ULTRA HD</span>';
    } else {
      quality = '<span class="quality-badge quality-hd">HD</span>';
    }

    // CSS classes
    var cls = 'match-card' + (live ? ' live' : '') + (poster ? ' poster' : '');

    return '<div class="' + cls + '" data-id="' + m.id + '" role="listitem" tabindex="0">'
      + (poster ? '<div class="match-bg" style="background-image:url(\'' + poster + '\')"></div>' : '')
      + '<div class="match-inner">'
      +   body
      +   '<div class="match-meta">'
      +     '<span class="match-category">' + sportEmoji(m.category) + ' ' + esc(m.category) + '</span>'
      +     badge
      +   '</div>'
      +   '<div class="match-quality-row">' + quality + streams + '</div>'
      +   '<button class="match-btn">\u25B6 Watch Now</button>'
      + '</div>'
      + '</div>';
  }

  /** Large card used in the popular horizontal scroll. */
  function popularCardHtml(m) {
    m = safeMatch(m);
    var live   = isLive(m);
    var poster = m.poster ? posterUrl(m.poster) : '';
    var hd     = hasHdSource(m);

    var bg = poster
      ? '<div class="pop-bg" style="background-image:url(\'' + poster + '\')"></div>'
      : '<div class="pop-bg" style="background:var(--bg-surface);display:flex;align-items:center;justify-content:center;font-size:48px">' + sportEmoji(m.category) + '</div>';

    var qualityTag = hd
      ? '<span class="quality-badge quality-4k">4K ULTRA HD</span>'
      : '<span class="quality-badge quality-hd">HD</span>';

    return '<div class="popular-card" data-id="' + m.id + '" tabindex="0" role="listitem">'
      + bg
      + '<div class="pop-overlay"></div>'
      + '<div class="pop-info">'
      +   (live ? '<span class="pop-badge">LIVE</span>' : '')
      +   '<div class="pop-title">' + esc(m.title) + '</div>'
      +   '<div class="pop-category">' + esc(m.category) + '</div>'
      +   qualityTag
      + '</div>'
      + '</div>';
  }

  /** Compact result item for the search overlay. */
  function searchItemHtml(m) {
    m = safeMatch(m);
    var live = isLive(m);
    return '<div class="search-item" data-id="' + m.id + '" tabindex="0">'
      + '<div class="search-item-info">'
      +   '<span class="search-item-title">' + esc(m.title) + '</span>'
      +   '<span class="search-item-meta">' + sportEmoji(m.category) + ' ' + esc(m.category) + (live ? ' \u2022 LIVE' : '') + '</span>'
      + '</div>'
      + '<span class="search-item-action">\u25B6 Watch</span>'
      + '</div>';
  }

  /* ===================================================================
   * Toast notifications
   * =================================================================== */

  function toast(msg, type) {
    if (isStreamingActive) return;
    type = type || 'info';
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    if (DOM.toastContainer) DOM.toastContainer.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity 300ms';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 4000);
  }

  /* ===================================================================
   * Streaming performance mode — pause background work during playback
   * =================================================================== */

  function pauseNonStreamBackgroundTasks() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    if (liveRefreshInterval) {
      clearInterval(liveRefreshInterval);
      liveRefreshInterval = null;
    }
  }

  function resumeNonStreamBackgroundTasks() {
    if (tabHidden || isStreamingActive) return;
    startCountdowns();
    startLiveRefresh();
  }

  function pauseAllBackgroundTasks() {
    pauseNonStreamBackgroundTasks();
    if (presenceInterval) {
      clearInterval(presenceInterval);
      presenceInterval = null;
    }
  }

  function enterStreamingMode() {
    isStreamingActive = true;
    presenceTick = 0;
    document.body.classList.add('streaming-active');
    pauseNonStreamBackgroundTasks();
    schedulePresenceInterval();
    updatePresence({ fetchStats: true });
  }

  function exitStreamingMode() {
    isStreamingActive = false;
    presenceTick = 0;
    document.body.classList.remove('streaming-active');
    resumeNonStreamBackgroundTasks();
    schedulePresenceInterval();
    updatePresence({ fetchStats: true });
  }

  function handleVisibilityChange() {
    tabHidden = document.hidden;
    if (tabHidden) {
      pauseAllBackgroundTasks();
      return;
    }
    schedulePresenceInterval();
    resumeNonStreamBackgroundTasks();
  }

  /* ===================================================================
   * Player system
   * =================================================================== */

  var currentMatch       = null;
  var currentStreams      = [];
  var activeStreamIndex  = 0;
  var fallbackTimer      = null;
  var triedStreams        = {};
  var isStreamLoading     = false;

  /** Open the player modal and load streams for the given match. */
  function openPlayer(match) {
    if (!match || !DOM.playerModal) return;

    enterStreamingMode();

    // Add modal-open to body to hide background elements and optimize rendering
    document.body.classList.add('modal-open');

    currentMatch = match;
    triedStreams  = {};
    state.streamLatencies = {};
    state.recommendedIndex = 0;

    if (DOM.modalTitle)   DOM.modalTitle.textContent = match.title;
    DOM.playerModal.classList.add('open', 'immersive');
    
    // Show the server analyzer overlay
    if (DOM.serverAnalyzerOverlay) {
      DOM.serverAnalyzerOverlay.classList.remove('hidden');
      DOM.analyzerStatus.textContent = 'Connecting to AeroX Sports network...';
      DOM.analyzerSub.textContent = 'Locating secure streaming channels...';
    }

    showProgress();
    hideConnectionQuality();
    startStreamViewers(match);
    if (DOM.modalIframe)  DOM.modalIframe.src = '';
    if (DOM.modalStreams)  DOM.modalStreams.innerHTML = '';

    // Match info bar
    if (DOM.modalInfo) {
      if (match.teams && match.teams.home && match.teams.away) {
        var hb = match.teams.home.badge ? badgeUrl(match.teams.home.badge) : '';
        var ab = match.teams.away.badge ? badgeUrl(match.teams.away.badge) : '';
        var dateStr = match.date
          ? new Date(match.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          : 'Ongoing';
        DOM.modalInfo.innerHTML =
            '<img class="modal-team-badge" src="' + hb + '" alt="" onerror="this.style.display=\'none\'">'
          + '<span>' + esc(match.teams.home.name) + '</span>'
          + '<span style="color:var(--text-secondary)">vs</span>'
          + '<img class="modal-team-badge" src="' + ab + '" alt="" onerror="this.style.display=\'none\'">'
          + '<span>' + esc(match.teams.away.name) + '</span>'
          + '<span>\u00B7</span><span>' + esc(match.category) + '</span>'
          + '<span>\u00B7</span><span>' + dateStr + '</span>';
      } else {
        DOM.modalInfo.innerHTML = '<span>' + esc(match.category) + '</span>';
      }
    }

    // Fetch all stream sources in parallel
    var sources = match.sources || [];
    if (sources.length === 0) {
      hideProgress();
      if (DOM.serverAnalyzerOverlay) DOM.serverAnalyzerOverlay.classList.add('hidden');
      if (DOM.modalIframe)  DOM.modalIframe.style.display = 'none';
      if (DOM.modalStreams) {
        DOM.modalStreams.innerHTML = '<span style="color:var(--text-secondary);font-size:13px;padding:8px 0">No streams available.</span>';
      }
      return;
    }

    if (DOM.analyzerStatus) DOM.analyzerStatus.textContent = 'Accessing AeroX media stream servers...';

    var prefetched = state.prefetchCache[match.id];
    if (prefetched && prefetched.ready && prefetched.streams && prefetched.streams.length) {
      currentStreams = prefetched.streams.slice();
      activeStreamIndex = 0;
      state.recommendedIndex = 0;
      if (DOM.analyzerStatus) DOM.analyzerStatus.textContent = 'Using preloaded stream data...';
      if (DOM.analyzerSub) DOM.analyzerSub.textContent = 'Connecting immediately — background tasks paused...';
      finalizeStreamSelection();
      return;
    }

    var fetches = sources.map(function (s) {
      return api(API_BASE + '/api/stream/' + s.source + '/' + s.id + '?_=' + Date.now());
    });

    Promise.allSettled(fetches).then(function (results) {
      currentStreams = collectStreamsFromResults(results);

      if (currentStreams.length === 0) {
        hideProgress();
        if (DOM.serverAnalyzerOverlay) DOM.serverAnalyzerOverlay.classList.add('hidden');
        if (DOM.modalStreams) {
          DOM.modalStreams.innerHTML = '<span style="color:var(--live);font-size:13px;padding:8px 0">No streams available.</span>';
        }
        toast('No streams for this match', 'error');
        return;
      }

      if (DOM.analyzerStatus) DOM.analyzerStatus.textContent = 'Comparing region latency...';
      if (DOM.analyzerSub) DOM.analyzerSub.textContent = 'Pinging connection speeds to all stream nodes...';

      rankStreamsByLatency(currentStreams).then(function (ranked) {
        applyRankedStreams(ranked);
        finalizeStreamSelection();
      });
    });
  }

  /** Render stream selection pills inside the player modal. */
  function renderStreamPills() {
    if (!DOM.modalStreams) return;
    DOM.modalStreams.innerHTML = '';

    for (var i = 0; i < currentStreams.length; i++) {
      var s      = currentStreams[i];
      var active = i === activeStreamIndex;
      var isRec  = i === state.recommendedIndex;
      var btn    = document.createElement('button');
      btn.className = 'stream-pill'
        + (active ? ' active' : '')
        + (isRec ? ' recommended' : '');
      btn.dataset.index = i;

      var label = (active ? '\u25CF' : '\u25CB') + ' ' + (s.source || 'Server') + ' ' + (s.language || '');
      if (isRec) label += ' <span class="recommended-badge">\u2605 Recommended</span>';
      if (s.hd) label += ' <span class="hd">HD</span> <span class="quality-4k">4K</span>';

      var latency = state.streamLatencies[i];
      if (latency !== undefined) {
        label += ' <span class="latency">' + latency + 'ms</span>';
      }

      btn.innerHTML = label;

      btn.addEventListener('click', function () {
        var idx = parseInt(this.dataset.index, 10);
        if (idx !== activeStreamIndex) {
          activeStreamIndex = idx;
          triedStreams = {};
          loadStream(idx);
        }
      });

      DOM.modalStreams.appendChild(btn);
    }

    // Skip / lag button
    if (currentStreams.length > 1) {
      var skipBtn = document.createElement('button');
      skipBtn.className = 'stream-pill skip-pill';
      skipBtn.textContent = '\u23ED Skip \u2014 Lagging?';
      skipBtn.addEventListener('click', function () {
        var next = (activeStreamIndex + 1) % currentStreams.length;
        if (next !== activeStreamIndex) {
          activeStreamIndex = next;
          triedStreams = {};
          toast('Switching stream\u2026', 'info');
          loadStream(next);
        }
      });
      DOM.modalStreams.appendChild(skipBtn);
    }
  }

  /** Update only the active state on existing stream pills (avoids full DOM rebuild). */
  function updateStreamPillActive() {
    if (!DOM.modalStreams) return;
    var pills = DOM.modalStreams.querySelectorAll('.stream-pill:not(.skip-pill)');
    for (var i = 0; i < pills.length; i++) {
      var idx = parseInt(pills[i].dataset.index, 10);
      pills[i].classList.toggle('active', idx === activeStreamIndex);
    }
  }

  /** Load a specific stream by index into the iframe. */
  function loadStream(index, isAuto) {
    var s = currentStreams[index];
    if (!s) return;

    activeStreamIndex = index;
    triedStreams[index] = true;
    isStreamLoading = true;

    showProgress();
    if (DOM.modalIframe) {
      DOM.modalIframe.style.display = '';
      DOM.modalIframe.src = s.embedUrl || '';
    }

    var latency = state.streamLatencies[index];
    if (latency !== undefined) showConnectionQuality(latency);

    if (DOM.modalStreams && DOM.modalStreams.querySelectorAll('.stream-pill').length > 0) {
      updateStreamPillActive();
    } else {
      renderStreamPills();
    }

    if (isAuto && index === state.recommendedIndex) {
      toast('\u2605 Auto-playing recommended server', 'info');
    }

    // Safety timeout to hide analyzer overlay even if iframe load fails/hangs
    setTimeout(function() {
      if (DOM.serverAnalyzerOverlay && !DOM.serverAnalyzerOverlay.classList.contains('hidden')) {
        DOM.serverAnalyzerOverlay.classList.add('hidden');
      }
    }, 3500);

    // 4-second fallback — auto-switch on timeout
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(function () {
      if (isStreamLoading) {
        var next = (activeStreamIndex + 1) % currentStreams.length;
        if (next !== activeStreamIndex && !triedStreams[next]) {
          toast('Auto-switching to next stream\u2026', 'info');
          loadStream(next);
        } else {
          toast('All streams failed to load.', 'error');
          hideProgress();
          isStreamLoading = false;
          if (DOM.serverAnalyzerOverlay) DOM.serverAnalyzerOverlay.classList.add('hidden');
        }
      }
    }, FALLBACK_TIMEOUT);
  }

  /** Close the player modal and reset state. */
  function closePlayer() {
    document.body.classList.remove('modal-open');
    exitStreamingMode();
    if (DOM.playerModal)  DOM.playerModal.classList.remove('open', 'immersive');
    if (DOM.modalIframe)  DOM.modalIframe.src = '';
    hideProgress();
    hideConnectionQuality();
    currentMatch       = null;
    stopStreamViewers();
    currentStreams      = [];
    activeStreamIndex  = 0;
    triedStreams        = {};
    isStreamLoading     = false;
    state.streamLatencies = {};
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  }

  /* ===================================================================
   * Search system
   * =================================================================== */

  function openSearch() {
    if (DOM.searchOverlay) DOM.searchOverlay.classList.add('open');
    if (DOM.searchInput)   DOM.searchInput.value = '';
    if (DOM.searchResults) DOM.searchResults.innerHTML = '';
    setTimeout(function () { if (DOM.searchInput) DOM.searchInput.focus(); }, 200);
  }

  function closeSearch() {
    if (DOM.searchOverlay) DOM.searchOverlay.classList.remove('open');
  }

  /** Debounce helper — returns a wrapper that delays invocation. */
  function debounce(fn, delay) {
    var timer;
    return function () {
      var ctx  = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, delay);
    };
  }

  /** Wire up the search input with debounced filtering. */
  function setupSearch() {
    if (!DOM.searchInput || !DOM.searchResults) return;

    var handler = debounce(function () {
      var q = DOM.searchInput.value.toLowerCase().trim();
      if (!q) { DOM.searchResults.innerHTML = ''; return; }

      var results = [];
      for (var i = 0; i < state.allMatches.length; i++) {
        var m = state.allMatches[i];
        if ((m.title && m.title.toLowerCase().indexOf(q) !== -1) ||
            (m.category && m.category.toLowerCase().indexOf(q) !== -1)) {
          results.push(m);
        }
        if (results.length >= 20) break;
      }

      if (results.length === 0) {
        DOM.searchResults.innerHTML = '<div class="search-empty">No matches found</div>';
        return;
      }

      DOM.searchResults.innerHTML = results.map(searchItemHtml).join('');

      // Bind click events on result items
      var items = DOM.searchResults.querySelectorAll('.search-item');
      for (var j = 0; j < items.length; j++) {
        items[j].addEventListener('click', function () {
          var m = findMatch(this.dataset.id);
          if (m) { closeSearch(); openPlayer(m); }
        });
      }
    }, 180);

    DOM.searchInput.addEventListener('input', handler);
  }

  /* ===================================================================
   * Match lookup
   * =================================================================== */

  function findMatch(id) {
    for (var i = 0; i < state.allMatches.length; i++) {
      if (state.allMatches[i].id === id) return state.allMatches[i];
    }
    return null;
  }

  /* ===================================================================
   * Card event binding (uses event delegation where practical)
   * =================================================================== */

  function bindCards(container) {
    if (!container) return;
    var cards = container.querySelectorAll('.match-card');
    for (var i = 0; i < cards.length; i++) {
      (function (el) {
        el.addEventListener('click', function () {
          var m = findMatch(el.dataset.id);
          if (m) openPlayer(m);
        });
        el.addEventListener('mouseenter', function () {
          var m = findMatch(el.dataset.id);
          if (m) prefetchStreams(m);
        });
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            var m = findMatch(el.dataset.id);
            if (m) openPlayer(m);
          }
        });
      })(cards[i]);
    }
  }

  function bindPopularCards(container) {
    if (!container) return;
    var cards = container.querySelectorAll('.popular-card');
    for (var i = 0; i < cards.length; i++) {
      (function (el) {
        el.addEventListener('click', function () {
          var m = findMatch(el.dataset.id);
          if (m) openPlayer(m);
        });
        el.addEventListener('mouseenter', function () {
          var m = findMatch(el.dataset.id);
          if (m) prefetchStreams(m);
        });
      })(cards[i]);
    }
  }

  /* ===================================================================
   * Render functions
   * =================================================================== */

  function renderLive(matches) {
    if (!DOM.liveGrid) return;

    if (!matches || matches.length === 0) {
      DOM.liveGrid.innerHTML =
          '<div class="empty-state">'
        +   '<div class="empty-icon">\uD83D\uDCE1</div>'
        +   '<p class="empty-title">No live broadcasts right now</p>'
        +   '<p class="empty-desc">Upcoming matches will appear here as they go live</p>'
        +   '<div class="empty-cards">'
        +     '<div class="empty-card"><div class="empty-card-dot empty-card-dot--football"></div><span>Football</span><span class="empty-card-time">12:30 PM</span></div>'
        +     '<div class="empty-card"><div class="empty-card-dot empty-card-dot--basketball"></div><span>Basketball</span><span class="empty-card-time">2:00 PM</span></div>'
        +     '<div class="empty-card"><div class="empty-card-dot empty-card-dot--tennis"></div><span>Tennis</span><span class="empty-card-time">4:15 PM</span></div>'
        +   '</div>'
        + '</div>';
      if (DOM.liveCount)     DOM.liveCount.textContent = '0 matches';
      if (DOM.statLive)      DOM.statLive.textContent = '\u2014';
      if (DOM.liveCountText) DOM.liveCountText.textContent = '0 LIVE';
      return;
    }

    DOM.liveGrid.innerHTML = matches.map(cardHtml).join('');
    if (DOM.liveCount)     DOM.liveCount.textContent     = matches.length + ' match' + (matches.length !== 1 ? 'es' : '');
    if (DOM.statLive)      DOM.statLive.textContent      = matches.length;
    if (DOM.liveCountText) DOM.liveCountText.textContent  = matches.length + ' LIVE';
    bindCards(DOM.liveGrid);
  }

  function renderToday(matches) {
    if (!DOM.todayGrid) return;

    if (!matches || matches.length === 0) {
      DOM.todayGrid.innerHTML =
          '<div class="empty-state">'
        +   '<div class="empty-icon">\uD83D\uDCC5</div>'
        +   '<p class="empty-title">No matches scheduled today</p>'
        +   '<p class="empty-desc">Check the schedule tomorrow for upcoming fixtures</p>'
        + '</div>';
      return;
    }

    // Group by category
    var groups = {};
    for (var i = 0; i < matches.length; i++) {
      var cat = matches[i].category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(matches[i]);
    }

    var html = '';
    var keys = Object.keys(groups);
    for (var g = 0; g < keys.length; g++) {
      var k         = keys[g];
      var catName   = k.charAt(0).toUpperCase() + k.slice(1);
      html += '<h3 style="font-family:var(--font-display);font-size:22px;margin:24px 0 12px;letter-spacing:0.5px">'
            + sportEmoji(k) + ' ' + catName + '</h3>';
      html += '<div class="match-grid" style="margin-bottom:8px">' + groups[k].map(cardHtml).join('') + '</div>';
    }

    DOM.todayGrid.innerHTML = html;
    bindCards(DOM.todayGrid);
  }

  function renderBrowse(matches) {
    if (!DOM.browseGrid) return;

    if (!matches || matches.length === 0) {
      DOM.browseGrid.innerHTML =
          '<div class="empty-state">'
        +   '<div class="empty-icon">\uD83C\uDFC6</div>'
        +   '<p class="empty-title">No matches found</p>'
        +   '<p class="empty-desc">Try selecting a different sport category</p>'
        + '</div>';
      return;
    }

    DOM.browseGrid.innerHTML = matches.map(cardHtml).join('');
    bindCards(DOM.browseGrid);
  }

  function renderPopular(matches) {
    if (!DOM.popularScroll) return;
    if (!matches || matches.length === 0) {
      DOM.popularScroll.innerHTML = '';
      return;
    }
    DOM.popularScroll.innerHTML = matches.map(popularCardHtml).join('');
    bindPopularCards(DOM.popularScroll);
  }

  /* ===================================================================
   * Sport pills — browse section
   * =================================================================== */

  function renderSportPills(sports) {
    if (!DOM.sportPills) return;

    DOM.sportPills.innerHTML = sports.map(function (s) {
      var active = s.id === state.currentSport;
      return '<button class="sport-pill' + (active ? ' active' : '') + '" data-sport="' + s.id + '" role="tab">'
           + sportEmoji(s.id) + ' ' + esc(s.name) + '</button>';
    }).join('');

    var pills = DOM.sportPills.querySelectorAll('.sport-pill');
    for (var i = 0; i < pills.length; i++) {
      pills[i].addEventListener('click', handleSportPillClick);
    }
  }

  function handleSportPillClick() {
    var el = this;
    var prev = DOM.sportPills.querySelector('.active');
    if (prev) prev.classList.remove('active');
    el.classList.add('active');

    state.currentSport = el.dataset.sport;
    if (DOM.browseGrid) DOM.browseGrid.innerHTML = skeletonGrid();

    var url;
    if (state.browseMode === 'popular') {
      url = API_BASE + '/api/matches/all/popular';
    } else {
      url = API_BASE + '/api/matches/' + state.currentSport;
    }

    api(url).then(function (matches) {
      if (state.browseMode === 'popular') {
        matches = (matches || []).filter(function (m) { return m.category === state.currentSport; });
      }
      state.browseMatches = matches || [];
      mergeMatches(matches);
      renderBrowse(matches);
      animateCards();
    }).catch(function () {
      if (DOM.browseGrid) {
        DOM.browseGrid.innerHTML =
            '<div style="grid-column:1/-1;text-align:center;padding:60px 20px">'
          + '<p style="color:var(--accent-red);margin-bottom:12px">Failed to load.</p>'
          + '<button class="btn btn-ghost" onclick="location.reload()">Retry</button></div>';
      }
    });
  }

  /* ===================================================================
   * Nav pills — top navigation (max 6 + More)
   * =================================================================== */

  function renderNavPills(sports) {
    if (!DOM.navPills) return;

    var max = Math.min(sports.length, 6);
    DOM.navPills.innerHTML = '';

    function navPillClick(sportId) {
      var act = DOM.navPills.querySelector('.active');
      if (act) act.classList.remove('active');
      var btn = DOM.navPills.querySelector('[data-sport="' + sportId + '"]');
      if (btn) btn.classList.add('active');
      var section = $('#browseSection');
      if (section) section.scrollIntoView({ behavior: 'smooth' });
      var pill = DOM.sportPills
        ? DOM.sportPills.querySelector('[data-sport="' + sportId + '"]')
        : null;
      if (pill) pill.click();
      closeMobileMenu();
    }

    for (var i = 0; i < max; i++) {
      (function (s) {
        var btn = document.createElement('button');
        btn.className = 'nav-pill' + (s.id === 'football' ? ' active' : '');
        btn.dataset.sport = s.id;
        btn.textContent = s.name;
        btn.addEventListener('click', function () { navPillClick(s.id); });
        DOM.navPills.appendChild(btn);
      })(sports[i]);
    }

    if (sports.length > 6) {
      var more = document.createElement('button');
      more.className = 'nav-pill more-pill';
      more.textContent = 'More \u25BE';
      more.addEventListener('click', function () {
        var section = $('#browseSection');
        if (section) section.scrollIntoView({ behavior: 'smooth' });
        closeMobileMenu();
      });
      DOM.navPills.appendChild(more);
    }

    // Mobile nav pills
    if (DOM.navMobilePills) {
      DOM.navMobilePills.innerHTML = '';
      for (var j = 0; j < sports.length; j++) {
        (function (s) {
          var mBtn = document.createElement('button');
          mBtn.className = 'nav-pill' + (s.id === 'football' ? ' active' : '');
          mBtn.dataset.sport = s.id;
          mBtn.textContent = sportEmoji(s.id) + ' ' + s.name;
          mBtn.addEventListener('click', function () { navPillClick(s.id); });
          DOM.navMobilePills.appendChild(mBtn);
        })(sports[j]);
      }
    }
  }

  function toggleMobileMenu() {
    if (!DOM.navHamburger || !DOM.navMobileMenu) return;
    var isOpen = DOM.navMobileMenu.classList.toggle('open');
    DOM.navHamburger.classList.toggle('open', isOpen);
    DOM.navHamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    DOM.navMobileMenu.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }

  function closeMobileMenu() {
    if (!DOM.navHamburger || !DOM.navMobileMenu) return;
    DOM.navMobileMenu.classList.remove('open');
    DOM.navHamburger.classList.remove('open');
    DOM.navHamburger.setAttribute('aria-expanded', 'false');
    DOM.navMobileMenu.setAttribute('aria-hidden', 'true');
  }

  /* ===================================================================
   * Match merging — deduplicate by ID
   * =================================================================== */

  function mergeMatches(incoming) {
    if (!incoming) return;
    var map = {};
    for (var i = 0; i < state.allMatches.length; i++) {
      map[state.allMatches[i].id] = state.allMatches[i];
    }
    for (var j = 0; j < incoming.length; j++) {
      if (incoming[j] && incoming[j].id) map[incoming[j].id] = incoming[j];
    }
    state.allMatches = Object.values(map);
  }

  /* ===================================================================
   * Countdown system — updates every second
   * =================================================================== */

  var countdownInterval = null;
  var countdownElements = null;

  function updateCountdowns() {
    if (!countdownElements) {
      countdownElements = Array.prototype.slice.call(document.querySelectorAll('[data-countdown]'));
    }
    var now = Date.now();
    var activeElements = [];
    for (var i = 0; i < countdownElements.length; i++) {
      var el = countdownElements[i];
      if (!document.body.contains(el)) continue;
      activeElements.push(el);
      var ts   = parseInt(el.dataset.countdown, 10);
      var diff = ts - now;
      if (diff <= 0) {
        el.textContent = 'STARTING';
        el.className   = 'match-badge live';
        continue;
      }
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      el.textContent = pad(h) + ':' + pad(m) + ':' + pad(s);
    }
    countdownElements = activeElements;
  }

  function startCountdowns() {
    countdownElements = null; // Clear cache to rebuild on next tick
    if (countdownInterval) clearInterval(countdownInterval);
    updateCountdowns();
    countdownInterval = setInterval(updateCountdowns, 1000);
  }

  /* ===================================================================
   * Card animations — staggered fade‑in + slide‑up
   * =================================================================== */

  function animateCards() {
    // No-op: Delegated to high-performance native CSS card entry animations
  }

  /* ===================================================================
   * Counter animations — easeOutCubic number counting
   * =================================================================== */

  function animateCounter(el, target, duration) {
    if (!el) return;
    duration = duration || 800;
    var start     = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
    var diff      = target - start;
    var startTime = 0;

    function tick(now) {
      if (!startTime) startTime = now;
      var elapsed  = now - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var eased    = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(start + diff * eased).toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  /* ===================================================================
   * Toggle handlers — Today & Browse sections
   * =================================================================== */

  function setupToggles() {
    // Today section: All / Popular
    if (DOM.popularToggle) {
      DOM.popularToggle.addEventListener('click', function () {
        var isPopular = DOM.popularToggle.classList.toggle('active');
        DOM.popularToggle.textContent = isPopular ? 'Popular' : 'All';
        if (DOM.todayGrid) DOM.todayGrid.innerHTML = skeletonGrid();

        var url = isPopular
          ? API_BASE + '/api/matches/all/popular'
          : API_BASE + '/api/matches/all-today';

        api(url).then(function (matches) {
          state.todayMatches = matches || [];
          mergeMatches(matches);
          renderToday(matches);
          animateCards();
        }).catch(function () {
          if (DOM.todayGrid) {
            DOM.todayGrid.innerHTML =
                '<div style="grid-column:1/-1;text-align:center;padding:60px 20px">'
              + '<p style="color:var(--accent-red);margin-bottom:12px">Failed to load.</p>'
              + '<button class="btn btn-ghost" style="margin:0 auto" onclick="location.reload()">Retry</button></div>';
          }
        });
      });
    }

    // Browse section: All / Popular
    if (DOM.browsePopularToggle) {
      DOM.browsePopularToggle.addEventListener('click', function () {
        var isPopular = DOM.browsePopularToggle.classList.toggle('active');
        DOM.browsePopularToggle.textContent = isPopular ? 'Popular' : 'All';
        state.browseMode = isPopular ? 'popular' : 'all';
        if (DOM.browseGrid) DOM.browseGrid.innerHTML = skeletonGrid();

        var url;
        if (isPopular) {
          url = API_BASE + '/api/matches/all/popular';
        } else {
          url = API_BASE + '/api/matches/' + state.currentSport;
        }

        api(url).then(function (matches) {
          if (isPopular) {
            matches = (matches || []).filter(function (m) { return m.category === state.currentSport; });
          }
          state.browseMatches = matches || [];
          mergeMatches(matches);
          renderBrowse(matches);
          animateCards();
        }).catch(function () {
          if (DOM.browseGrid) {
            DOM.browseGrid.innerHTML =
                '<div style="grid-column:1/-1;text-align:center;padding:60px 20px">'
              + '<p style="color:var(--accent-red);margin-bottom:12px">Failed to load.</p>'
              + '<button class="btn btn-ghost" style="margin:0 auto" onclick="location.reload()">Retry</button></div>';
          }
        });
      });
    }
  }

  /* ===================================================================
   * Auto‑refresh — silently update live section every 2 minutes
   * =================================================================== */

  var liveRefreshInterval = null;

  function startLiveRefresh() {
    if (liveRefreshInterval) clearInterval(liveRefreshInterval);

    liveRefreshInterval = setInterval(function () {
      // Bust the cache for live matches so we get fresh data
      delete cache[API_BASE + '/api/matches/live'];

      api(API_BASE + '/api/matches/live').then(function (matches) {
        matches = matches || [];
        state.liveMatches = matches;
        mergeMatches(matches);
        renderLive(matches);
        startCountdowns();
      }).catch(function () {
        // Silent fail — keep existing data
      });
    }, 120000); // 2 minutes
  }

  /* ===================================================================
   * Initialisation
   * =================================================================== */

  function init() {
    try {
      initDom();
    } catch (e) {
      console.error('[AeroX] DOM init failed:', e);
      return;
    }

    // Show skeleton loaders immediately
    if (DOM.liveGrid)      DOM.liveGrid.innerHTML      = skeletonGrid();
    if (DOM.todayGrid)     DOM.todayGrid.innerHTML      = skeletonGrid();
    if (DOM.browseGrid)    DOM.browseGrid.innerHTML     = skeletonGrid();
    if (DOM.popularScroll) DOM.popularScroll.innerHTML  = skeletonHScroll();

    // Parallel data fetch
    Promise.all([
      api(API_BASE + '/api/sports').catch(function ()               { return []; }),
      api(API_BASE + '/api/matches/live').catch(function ()         { return []; }),
      api(API_BASE + '/api/matches/all-today').catch(function ()    { return []; }),
      api(API_BASE + '/api/matches/all/popular').catch(function ()  { return []; }),
      api(API_BASE + '/api/matches/football').catch(function ()     { return []; })
    ]).then(function (results) {
      var sports          = results[0] || [];
      var liveMatches     = results[1] || [];
      var todayMatches    = results[2] || [];
      var popularMatches  = results[3] || [];
      var footballMatches = results[4] || [];

      // Store in state
      state.sports         = sports;
      state.liveMatches    = liveMatches;
      state.todayMatches   = todayMatches;
      state.popularMatches = popularMatches;
      state.browseMatches  = footballMatches;

      // Merge all into allMatches (deduped)
      mergeMatches([].concat(liveMatches, todayMatches, popularMatches, footballMatches));

      // Render all sections
      renderNavPills(sports);
      renderSportPills(sports);
      renderLive(liveMatches);
      renderToday(todayMatches);
      renderBrowse(footballMatches);
      renderPopular(popularMatches);

      // Stats — show dash when zero, animate when data exists
      if (DOM.statEvents) DOM.statEvents.textContent = todayMatches.length || '\u2014';
      if (DOM.statSports) DOM.statSports.textContent = sports.length || '\u2014';
      if (DOM.statLive)   DOM.statLive.textContent   = liveMatches.length || '\u2014';

      if (liveMatches.length)  animateCounter(DOM.statLive,   liveMatches.length);
      if (todayMatches.length) animateCounter(DOM.statEvents, todayMatches.length);
      if (sports.length)       animateCounter(DOM.statSports, sports.length);

      // Pause hero animations when scrolled out of view (keeps scrolling smooth)
      pauseHeroWhenOffscreen();

      // Start timers
      startCountdowns();
      animateCards();

      // Start live auto‑refresh
      startLiveRefresh();

      // Generate unique sessionId if not present in sessionStorage
      try {
        state.sessionId = sessionStorage.getItem('aerox_session_id');
        if (!state.sessionId) {
          state.sessionId = 'sess_' + Math.random().toString(36).substring(2, 11);
          sessionStorage.setItem('aerox_session_id', state.sessionId);
        }
      } catch (ex) {
        state.sessionId = 'sess_' + Math.random().toString(36).substring(2, 11);
      }

      // Initialize presence tracking
      initPresence();

      // Initialize scroll reveal animations
      initScrollReveal();

      // Bind events
      bindGlobalEvents();

    }).catch(function (err) {
      console.error('[AeroX] Init error:', err);
      showConnectionError();
    });
  }

  /* ===================================================================
   * Scroll Reveal animation controller
   * =================================================================== */
  function initScrollReveal() {
    var els = document.querySelectorAll('.scroll-reveal');
    if (!els.length || !('IntersectionObserver' in window)) {
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('reveal-in');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.02 });
    for (var j = 0; j < els.length; j++) {
      els[j].classList.add('js-active');
      observer.observe(els[j]);
    }
  }

  /* ===================================================================
   * Pause hero animations when off-screen (avoids constant GPU work)
   * =================================================================== */

  function pauseHeroWhenOffscreen() {
    var hero = document.getElementById('hero');
    if (!hero || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        hero.classList.toggle('hero-paused', !e.isIntersecting);
      });
    }, { threshold: 0 });
    io.observe(hero);
  }

  /* ===================================================================
   * Global event bindings — called once after successful init
   * =================================================================== */

  function bindGlobalEvents() {
    // Modal close
    if (DOM.modalClose) DOM.modalClose.addEventListener('click', closePlayer);
    if (DOM.playerModal) {
      DOM.playerModal.addEventListener('click', function (e) {
        if (e.target === DOM.playerModal) closePlayer();
      });
    }

    // Escape key — close modal or search
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (DOM.playerModal && DOM.playerModal.classList.contains('open')) closePlayer();
        else if (DOM.searchOverlay && DOM.searchOverlay.classList.contains('open')) closeSearch();
      }
    });

    // Iframe load — hide progress bar, cancel fallback, hide server analyzer
    if (DOM.modalIframe) {
      DOM.modalIframe.addEventListener('load', function () {
        isStreamLoading = false;
        hideProgress();
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        if (DOM.serverAnalyzerOverlay) {
          DOM.serverAnalyzerOverlay.classList.add('hidden');
        }
      });
    }

    // Mobile hamburger menu
    if (DOM.navHamburger) {
      DOM.navHamburger.addEventListener('click', toggleMobileMenu);
    }

    // Search events
    if (DOM.searchToggle)   DOM.searchToggle.addEventListener('click', openSearch);
    if (DOM.searchBackdrop) DOM.searchBackdrop.addEventListener('click', closeSearch);
    if (DOM.searchClear) {
      DOM.searchClear.addEventListener('click', function () {
        if (DOM.searchInput)   DOM.searchInput.value = '';
        if (DOM.searchResults) DOM.searchResults.innerHTML = '';
        if (DOM.searchInput)   DOM.searchInput.focus();
      });
    }
    setupSearch();

    // Hero buttons — scroll to sections
    if (DOM.heroWatchBtn) {
      DOM.heroWatchBtn.addEventListener('click', function () {
        var el = $('#liveSection');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      });
    }
    if (DOM.heroScheduleBtn) {
      DOM.heroScheduleBtn.addEventListener('click', function () {
        var el = $('#todaySection');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Live counter button — scroll to live
    if (DOM.liveCounterBtn) {
      DOM.liveCounterBtn.addEventListener('click', function () {
        var el = $('#liveSection');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Toggle controls
    setupToggles();

    // Pause all background work when tab is hidden
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  /* ===================================================================
   * Connection error state
   * =================================================================== */

  function showConnectionError() {
    var errHtml =
        '<div style="grid-column:1/-1;text-align:center;padding:80px 20px">'
      +   '<div style="font-size:48px;margin-bottom:16px">\u26A0\uFE0F</div>'
      +   '<h2 style="font-size:20px;margin-bottom:8px">Connection Error</h2>'
      +   '<p style="color:var(--text-secondary);margin-bottom:8px">Could not reach the streaming service.</p>'
      +   '<p style="color:var(--text-secondary);margin-bottom:20px;font-size:13px">Make sure you are running from a local server (not file://) and have internet access.</p>'
      +   '<button class="btn btn-primary" onclick="location.reload()">Retry</button>'
      + '</div>';

    if (DOM.liveGrid)   DOM.liveGrid.innerHTML   = errHtml;
    if (DOM.todayGrid)  DOM.todayGrid.innerHTML  = errHtml;
    if (DOM.browseGrid) DOM.browseGrid.innerHTML = errHtml;
    if (DOM.liveCount)     DOM.liveCount.textContent     = '0 matches';
    if (DOM.liveCountText) DOM.liveCountText.textContent = '0 LIVE';
    toast('Failed to connect. Serve via HTTP server.', 'error');
  }

  /* ===================================================================
   * Boot
   * =================================================================== */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
