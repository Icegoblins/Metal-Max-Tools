window.jukeboxMgr = {
    PLAYBACK_KEY: 'mm2r_jukebox_playback_v1',
    currentIndex: -1,
    timer: null,


    playMode: 0, // 0: 列表循环, 1: 单曲循环, 2: 随机播放
    playlist: [], // 新增：专门存放点唱机的歌曲列表，不随页面切换改变
    modeLabels: ["列表循环", "单曲循环", "随机模式"],
    history: [], // 随机去重：记录哪些歌还没播，播完一轮才清空
    playStack: [], // 播放足迹：记录用户实际听歌的先后顺序，用于"上一首"回溯
    audioCtx: null,
    analyser: null,
    source: null,
    isFading: false,
    loadGeneration: 0,
    _endedHandledForGen: null,
    _loopRestarting: false,
    _userPaused: false,
    _autoFailCount: 0,
    _endHandlerBound: false,
    _switchingTrack: false,
    _scrubbing: false,
    _seekLockTime: null,
    _seekLockUntil: 0,
    __trackBlobUrl: null,
    __coverCache: {},
    __coverCacheMax: 100,
    volume: 1, // 记忆音量，淡入与非点唱机页的迷你音量条共用
    muted: false,
    volumeBeforeMute: 1,
    badgeCollapsed: false,

    isMapPage: function () {
        return document.body.classList.contains('mm-map-page') || !!document.getElementById('map-minimap');
    },

    applyMiniPlayerLayout: function () {
        const onMap = this.isMapPage();
        const badge = document.getElementById('now-playing-badge');
        const peek = document.getElementById('now-playing-peek');
        const host = onMap ? document.getElementById('map-ui') : document.body;
        const nav = document.getElementById('map-minimap');

        [badge, peek].forEach((el) => {
            if (!el) return;
            el.classList.toggle('map-layout', onMap);
            el.classList.toggle('mini-bar-compact', !onMap);
            if (host && el.parentElement !== host) host.appendChild(el);
        });

        if (onMap && host && nav) {
            if (badge) host.insertBefore(badge, nav);
            if (peek) host.insertBefore(peek, nav);
            document.documentElement.style.setProperty('--map-nav-width', nav.offsetWidth + 'px');
            const head = nav.querySelector('.minimap-head');
            if (head) {
                document.documentElement.style.setProperty('--map-nav-head-height', head.offsetHeight + 'px');
            }
        }

        if (!onMap) return;

        if (!this.__mapLayoutHooked) {
            this.__mapLayoutHooked = true;
            window.addEventListener('resize', () => this.applyMiniPlayerLayout());
            const toggle = document.getElementById('minimap-toggle');
            if (toggle) {
                toggle.addEventListener('click', () => {
                    setTimeout(() => this.applyMiniPlayerLayout(), 0);
                });
            }
        }
    },

    savePlaybackState: function () {
        try {
            const audio = this.getAudio();
            if (!audio || this.currentIndex < 0 || !this.playlist.length) {
                sessionStorage.removeItem(this.PLAYBACK_KEY);
                return;
            }
            const item = this.playlist[this.currentIndex];
            if (!item) return;
            // 曲单只被整体替换（无原地变更）：按引用缓存序列化，
            // timeupdate 每 2 秒的持久化不再反复 stringify 整张歌单
            const plKey = this.PLAYBACK_KEY + ':playlist';
            if (this.__plSerialRef !== this.playlist) {
                this.__plSerialRef = this.playlist;
                try { sessionStorage.setItem(plKey, JSON.stringify(this.playlist)); } catch (_) {}
            }
            sessionStorage.setItem(this.PLAYBACK_KEY, JSON.stringify({
                currentIndex: this.currentIndex,
                currentTime: audio.currentTime || 0,
                paused: !!audio.paused,
                userPaused: !!this._userPaused,
                playMode: this.playMode,
                volume: this.volume,
                muted: this.muted,
                volumeBeforeMute: this.volumeBeforeMute,
                history: this.history,
                playStack: this.playStack,
                badgeCollapsed: this.badgeCollapsed,
                savedAt: Date.now()
            }));
        } catch (e) {
            console.warn('jukebox save state failed', e);
        }
    },

    restorePlaybackState: async function () {
        let raw;
        try {
            raw = sessionStorage.getItem(this.PLAYBACK_KEY);
        } catch (_) { return false; }
        if (!raw) return false;

        let state;
        try { state = JSON.parse(raw); } catch (_) { return false; }
        // 新格式：playlist 存独立键（避免高频持久化反复序列化整张歌单）；旧格式内嵌，兼容读取
        let playlist = state.playlist;
        if (!Array.isArray(playlist)) {
            try {
                const plRaw = sessionStorage.getItem(this.PLAYBACK_KEY + ':playlist');
                if (plRaw) playlist = JSON.parse(plRaw);
            } catch (_) { playlist = null; }
        }
        if (!state || !Array.isArray(playlist) || state.currentIndex < 0) return false;

        const item = playlist[state.currentIndex];
        if (!item || !item.文件名) return false;

        const audio = this.getAudio();
        if (this.currentIndex >= 0 && this.playlist.length && audio && audio.src) {
            const cur = this.playlist[this.currentIndex];
            if (cur && cur.文件名 === item.文件名) return true;
        }

        this.playlist = playlist;
        this.currentIndex = state.currentIndex;
        this.playMode = state.playMode ?? 0;
        this.history = state.history || [];
        this.playStack = state.playStack || [];
        this.volume = state.volume ?? 1;
        this.muted = state.muted ?? false;
        this.volumeBeforeMute = state.volumeBeforeMute ?? 1;
        this.badgeCollapsed = state.badgeCollapsed ?? false;

        const songName = item.标题 || item.名称 || item.文件名;
        this.updateNowPlaying(songName);
        this.setVolume(Math.round((this.volume || 1) * 100));
        this.syncNowPlayingVisibility();
        this.syncFavUI();

        if (!audio) return false;

        this.bindTrackEndHandler();
        const gen = ++this.loadGeneration;
        const seekTime = Math.max(0, state.currentTime || 0);
        const shouldPlay = !state.paused && !state.userPaused;

        this._userPaused = !shouldPlay;
        this._switchingTrack = true;

        try {
            await this.loadTrackSrc(item.文件名, gen);
        } catch (e) {
            console.warn('restore loadTrackSrc failed', e);
            this._switchingTrack = false;
            return false;
        }
        if (gen !== this.loadGeneration) return false;

        return new Promise((resolve) => {
            const finish = (ok) => {
                this._switchingTrack = false;
                resolve(ok);
            };

            const onReady = () => {
                if (gen !== this.loadGeneration) return;
                if (seekTime > 0 && isFinite(audio.duration) && audio.duration > 0) {
                    try { audio.currentTime = Math.min(seekTime, audio.duration - 0.1); } catch (_) {}
                }
                this.updateProgress();

                if (shouldPlay) {
                    this._userPaused = false;
                    this.initAudioContext();
                    audio.play().then(() => {
                        this.fade('in');
                        this.startAnimation();
                        this.updateButton(true);
                        finish(true);
                    }).catch((e) => {
                        console.warn('restore play failed', e);
                        this.updateButton(false);
                        finish(false);
                    });
                } else {
                    this._userPaused = true;
                    audio.volume = this.volume ?? 1;
                    this.updateButton(false);
                    finish(true);
                }
            };

            if (audio.readyState >= 1) onReady();
            else audio.addEventListener('loadedmetadata', onReady, { once: true });
        });
    },

    bindPlaybackPersistence: function () {
        if (this.__persistBound) return;
        this.__persistBound = true;

        const save = () => this.savePlaybackState();
        window.addEventListener('pagehide', save);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') save();
        });

        const hook = () => {
            const audio = this.getAudio();
            if (!audio || audio.__persistHooked) return;
            audio.__persistHooked = true;
            let lastSave = 0;
            audio.addEventListener('timeupdate', () => {
                const now = Date.now();
                if (now - lastSave > 2000) {
                    lastSave = now;
                    save();
                }
            });
            audio.addEventListener('pause', () => setTimeout(save, 0));
            audio.addEventListener('play', () => setTimeout(save, 0));
        };
        hook();
        if (!this.getAudio()) {
            document.addEventListener('DOMContentLoaded', hook, { once: true });
        }
    },

    initAudioContext: function () {
        if (this.audioCtx) return;
        const audio = document.getElementById('global-audio-engine');
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioCtx.createAnalyser();
        this.source = this.audioCtx.createMediaElementSource(audio);
        this.source.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
        this.analyser.fftSize = 512; // 调大尺寸可以获得更细腻的频谱分布
        this.analyser.smoothingTimeConstant = 0.8; // 取值 0 到 1 之间，越小跳得越快、越敏感
    },

    _cancelFade: function () {
        if (this._fadeTimer) {
            clearTimeout(this._fadeTimer);
            this._fadeTimer = null;
        }
        if (this._fadeSafety) {
            clearTimeout(this._fadeSafety);
            this._fadeSafety = null;
        }
        this.isFading = false;
    },

    // 淡入淡出：用 performance.now 插值；前台保留 200ms 过渡，后台/最小化时直接完成以免定时器被节流卡住切歌
    fade: function (type, callback) {
        const audio = document.getElementById('global-audio-engine');
        if (!audio) {
            if (callback) callback();
            return;
        }

        this._cancelFade();

        const targetVol = type === 'in'
            ? (this.volume !== undefined ? this.volume : (parseInt(document.getElementById('vol-control-input')?.value || 100) / 100))
            : 0;
        const startVol = audio.volume;
        const duration = 200;
        let finished = false;

        const finish = () => {
            if (finished) return;
            finished = true;
            this._cancelFade();
            audio.volume = targetVol;
            if (callback) callback();
        };

        // 窗口最小化或页面不可见时，setTimeout 会被严重节流，跳过动画直接过渡
        if (document.hidden) {
            finish();
            return;
        }

        this.isFading = true;
        const startTime = performance.now();

        const step = () => {
            if (finished) return;
            const t = Math.min(1, (performance.now() - startTime) / duration);
            audio.volume = startVol + (targetVol - startVol) * t;
            if (t >= 1) {
                finish();
            } else {
                this._fadeTimer = setTimeout(step, 10);
            }
        };

        // 到期强制收尾，避免 step 链偶发断掉
        this._fadeSafety = setTimeout(finish, duration + 80);
        step();
    },

    isNearTrackEnd: function (audio) {
        if (!audio) return false;
        const dur = audio.duration;
        if (!isFinite(dur) || dur <= 0) return false;
        return audio.currentTime >= dur - 0.35;
    },

    handleTrackEnded: function () {
        const audio = this.getAudio();
        if (!audio || this.currentIndex < 0) return;
        if (this._switchingTrack || this._userPaused || this._scrubbing) return;
        if (this._loopRestarting) return;
        if (this._endedHandledForGen === this.loadGeneration) return;
        this._endedHandledForGen = this.loadGeneration;

        if (this.playMode === 1) {
            this._loopRestarting = true;
            try { audio.currentTime = 0; } catch (_) {}
            audio.play().then(() => {
                this._loopRestarting = false;
                this._endedHandledForGen = null;
                this.updateButton(true);
            }).catch((e) => {
                console.error('Playback failed:', e);
                this._loopRestarting = false;
                this._endedHandledForGen = null;
                this.updateButton(false);
            });
            return;
        }
        this.next(true);
    },

    bindTrackEndHandler: function () {
        const audio = this.getAudio();
        if (!audio) return;
        audio.loop = false;
        audio.onended = null;
        if (this._endHandlerBound) return;
        this._endHandlerBound = true;

        audio.addEventListener('ended', () => this.handleTrackEnded());
        audio.addEventListener('timeupdate', () => {
            if (this._loopRestarting && audio.currentTime < 0.5) {
                this._loopRestarting = false;
                this._endedHandledForGen = null;
            }
            if (this._userPaused || this._scrubbing || audio.paused) return;
            if (this.isNearTrackEnd(audio)) this.handleTrackEnded();
        });
        // WebView2 经 MediaElementSource 后经常只 pause、不派发 ended
        audio.addEventListener('pause', () => {
            if (this._userPaused || this._scrubbing || this.isFading) return;
            if (this.isNearTrackEnd(audio)) this.handleTrackEnded();
        });
    },

    initAudio: function () {
        this.bindTrackEndHandler();
    },

    // 切换播放模式
    toggleMode: function () {
        this.playMode = (this.playMode + 1) % 3;
        const btn = document.getElementById('mode-btn');
        if (btn) btn.innerText = "MODE: " + this.modeLabels[this.playMode];
        // 同步迷你控制台按钮文字
        const npMode = document.getElementById('np-mode');
        if (npMode) npMode.innerText = this.modeLabels[this.playMode];
        if (npMode) npMode.title = 'MODE: ' + this.modeLabels[this.playMode];

        // 模式变更日志只允许出现在点唱机页面，避免污染其他分类的详情区
        const activeTab = document.querySelector('.tab-btn.active')?.innerText;
        if (activeTab === '点唱机') {
            const logMsg = `>> SYSTEM: 播放模式已更改为 [${this.modeLabels[this.playMode]}]`;
            if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(logMsg);
        }
    },

    next: function (isAuto = false) {
        const data = this.playlist;
        const total = data.length;
        if (!data || data.length === 0) return;
        let nextIdx;

        if (this.playMode === 2) {
            let available = Array.from({ length: total }, (_, i) => i)
                .filter(i => !this.history.includes(i));
            if (available.length === 0) {
                this.history = [];
                available = Array.from({ length: total }, (_, i) => i).filter(i => i !== this.currentIndex);
            }
            if (available.length === 0) {
                nextIdx = this.currentIndex;
            } else {
                nextIdx = available[Math.floor(Math.random() * available.length)];
            }
        } else {
            nextIdx = (this.currentIndex + 1) % total;
        }
        this.select(nextIdx, true);
    },

    getAudio: function () {
        return document.getElementById('global-audio-engine');
    },

    // 换目录 / 重新扫描后清空播放器内部曲库，避免继续播旧目录
    resetLibrary: function () {
        this.loadGeneration++;
        this._switchingTrack = false;
        this._endedHandledForGen = null;
        this._loopRestarting = false;
        this._userPaused = false;
        this._scrubbing = false;
        this._autoFailCount = 0;
        this.playlist = [];
        this.currentIndex = -1;
        this.history = [];
        this.playStack = [];
        this.__urlCache = {};
        this.__coverKey = null;
        Object.values(this.__coverCache || {}).forEach((url) => {
            try { URL.revokeObjectURL(url); } catch (_) {}
        });
        this.__coverCache = {};
        if (this.timer) {
            cancelAnimationFrame(this.timer);
            this.timer = null;
        }
        this._cancelFade();
        const audio = this.getAudio();
        if (audio) {
            try { audio.pause(); } catch (_) {}
            audio.removeAttribute('src');
            audio.src = '';
            try { audio.load(); } catch (_) {}
        }
        if (this.__trackBlobUrl) {
            URL.revokeObjectURL(this.__trackBlobUrl);
            this.__trackBlobUrl = null;
        }
        this.resetProgressUI();
        this.updateButton(false);
        const art = document.getElementById('track-art');
        if (art) art.src = this.defaultCoverUrl();
        const titleElem = document.getElementById('playing-title');
        if (titleElem) titleElem.innerText = 'TRACK: SYSTEM_READY';
        const detName = document.getElementById('det-name');
        if (detName) detName.innerText = '音乐点唱机';
        const topBox = document.getElementById('item-title-box');
        if (topBox) topBox.innerText = '音乐点唱机';
        const badge = document.getElementById('now-playing-badge');
        const peek = document.getElementById('now-playing-peek');
        if (badge) badge.style.display = 'none';
        if (peek) peek.style.display = 'none';
        this.applyMiniPlayerLayout();
        this.syncFavUI();
        this.syncGroupUI();
        this.syncBatchUI();
        try { sessionStorage.removeItem(this.PLAYBACK_KEY); } catch (_) {}
    },

    localMusicUrl: function (relPath) {
        if (!relPath) return '';
        if (typeof window.encodeLocalMusicPath === 'function') {
            return window.encodeLocalMusicPath(relPath);
        }
        return 'local-music/' + relPath.split('/').map(encodeURIComponent).join('/');
    },

    // 由 Rust 统一编码并校验文件存在，避免 WebView 双重 URL 编码
    resolveMusicUrl: async function (relPath) {
        if (!relPath) return '';
        if (!this.__urlCache) this.__urlCache = {};
        if (this.__urlCache[relPath]) return this.__urlCache[relPath];
        if (typeof window.__TAURI__ !== 'undefined' && window.__TAURI__.core) {
            try {
                const url = await window.__TAURI__.core.invoke('get_local_music_url_cmd', { relativePath: relPath });
                this.__urlCache[relPath] = url;
                return url;
            } catch (_) {
                return '';
            }
        }
        return this.localMusicUrl(relPath);
    },

    defaultCoverUrl: function () {
        return 'music/default.png';
    },

    sidecarCoverNames: function (fileName) {
        const stem = fileName.replace(/\.[^.]+$/, '');
        return ['.jpg', '.png', '.webp'].map(ext => stem + ext);
    },

    probeImage: function (url) {
        return new Promise((resolve) => {
            if (!url) return resolve(false);
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
        });
    },

    readU32: function (bytes, off) {
        return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
    },

    readBoxType: function (bytes, off) {
        return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    },

    // 从 m4a/mp4 容器解析 iTunes covr 内嵌封面
    extractCovrFromMp4: function (buffer) {
        const bytes = new Uint8Array(buffer);
        const readU32 = this.readU32.bind(this);
        const readType = this.readBoxType.bind(this);
        const stack = [{ start: 0, end: bytes.length }];

        while (stack.length) {
            const { start, end } = stack.pop();
            let off = start;
            while (off + 8 <= end) {
                let size = readU32(bytes, off);
                const type = readType(bytes, off + 4);
                let header = 8;
                let content = off + 8;
                if (size === 0) size = end - off;
                else if (size === 1) {
                    if (off + 16 > end) break;
                    const hi = readU32(bytes, off + 8);
                    const lo = readU32(bytes, off + 12);
                    size = hi * 0x100000000 + lo;
                    header = 16;
                    content = off + 16;
                }
                if (size < header || off + size > end) break;
                const boxEnd = off + size;

                if (type === 'covr') {
                    let inner = content;
                    while (inner + 8 <= boxEnd) {
                        const ds = readU32(bytes, inner);
                        const dt = readType(bytes, inner + 4);
                        if (ds < 8) break;
                        const dataEnd = Math.min(boxEnd, inner + ds);
                        if (dt === 'data' && dataEnd - inner > 16) {
                            return bytes.slice(inner + 16, dataEnd);
                        }
                        inner += ds;
                    }
                }

                const childStart = content + (type === 'meta' ? 4 : 0);
                if (childStart < boxEnd) stack.push({ start: childStart, end: boxEnd });
                off = boxEnd;
            }
        }
        return null;
    },

    mimeFromCoverBytes: function (bytes) {
        if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
        if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
        return 'image/jpeg';
    },

    // 读取音频文件内嵌封面（m4a covr）；结果按曲目缓存（LRU，超上限 revoke 最久未用的 blob URL）
    loadEmbeddedCover: async function (rawItem) {
        const art = document.getElementById('track-art');
        if (!art || !rawItem?.文件名) return false;

        const key = rawItem.文件名;
        // covr 原子只存在于 mp4 容器：mp3/flac 等无需把整个文件读进内存
        if (!/\.(m4a|mp4|m4b)$/i.test(String(key))) return false;

        const cached = this.__coverCache[key];
        if (cached) {
            // 刷新 LRU 顺序（对象按插入序遍历）
            delete this.__coverCache[key];
            this.__coverCache[key] = cached;
            if (this.__coverKey === key) art.src = cached;
            return true;
        }

        try {
            const fileUrl = await this.resolveMusicUrl(key);
            if (!fileUrl) return false;
            const res = await fetch(fileUrl);
            if (!res.ok) return false;
            const covr = this.extractCovrFromMp4(await res.arrayBuffer());
            if (!covr || !covr.length) return false;

            const blob = new Blob([covr], { type: this.mimeFromCoverBytes(covr) });
            const url = URL.createObjectURL(blob);
            const keys = Object.keys(this.__coverCache);
            if (keys.length >= this.__coverCacheMax) {
                const oldest = keys[0];
                try { URL.revokeObjectURL(this.__coverCache[oldest]); } catch (_) {}
                delete this.__coverCache[oldest];
            }
            this.__coverCache[key] = url;
            if (this.__coverKey === key) art.src = url;
            return true;
        } catch (e) {
            return false;
        }
    },

    // 桌面端：从用户音乐目录经 local-music/ 静态路由加载
    loadTrackSrc: async function (fileName, gen) {
        const audio = this.getAudio();
        if (!audio || !fileName) return;
        if (gen != null && gen !== this.loadGeneration) return;
        const fileUrl = await this.resolveMusicUrl(fileName);
        if (!fileUrl || gen != null && gen !== this.loadGeneration) return;
        try {
            const res = await fetch(fileUrl);
            if (!res.ok) throw new Error('fetch failed');
            const blob = await res.blob();
            if (gen != null && gen !== this.loadGeneration) return;
            if (this.__trackBlobUrl) URL.revokeObjectURL(this.__trackBlobUrl);
            this.__trackBlobUrl = URL.createObjectURL(blob);
            audio.src = this.__trackBlobUrl;
        } catch (err) {
            console.warn('blob load fallback:', err);
            if (gen != null && gen !== this.loadGeneration) return;
            if (this.__trackBlobUrl) {
                URL.revokeObjectURL(this.__trackBlobUrl);
                this.__trackBlobUrl = null;
            }
            audio.src = fileUrl;
        }
    },

    // ===== 播放进度条（独立模块：指针拖拽 + 点击跳转，UI 与音频解耦） =====
    pointerRatio: function (e, track) {
        const rect = track.getBoundingClientRect();
        if (!rect.width) return 0;
        return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    },

    setProgressVisual: function (ratio, audio) {
        const per = Math.max(0, Math.min(1, ratio));
        const bar = document.getElementById('prog-bar-inner');
        if (bar) bar.style.width = (per * 100) + '%';
        const timeDisp = document.getElementById('time-display');
        const a = audio || this.getAudio();
        if (timeDisp && a && isFinite(a.duration) && a.duration > 0) {
            timeDisp.innerText = `${this.formatTime(per * a.duration)} / ${this.formatTime(a.duration)}`;
        }
    },

    resetProgressUI: function () {
        this.setProgressVisual(0);
    },

    commitSeek: function (ratio) {
        const audio = this.getAudio();
        if (!audio || this.currentIndex < 0) return;

        ratio = Math.max(0, Math.min(1, ratio));
        const wasPlaying = !audio.paused;

        if (!isFinite(audio.duration) || audio.duration <= 0) {
            audio.__pendingSeekRatio = ratio;
            audio.__pendingSeekGen = this.loadGeneration;
            this.setProgressVisual(ratio, audio);
            return;
        }

        const targetTime = Math.max(0, ratio * (audio.duration - 0.05));
        this._seekLockTime = targetTime;
        this._seekLockUntil = Date.now() + 1500;
        this.setProgressVisual(ratio, audio);

        try {
            audio.currentTime = targetTime;
        } catch (_) {}

        audio.addEventListener('seeked', () => {
            this._seekLockTime = null;
            this.updateProgress();
        }, { once: true });

        if (wasPlaying && audio.paused) {
            audio.play().catch(() => {});
        }
    },

    applyPendingSeek: function (audio) {
        if (!audio || audio.__pendingSeekGen !== this.loadGeneration) return;
        if (audio.__pendingSeekRatio == null) return;
        if (!isFinite(audio.duration) || audio.duration <= 0) return;
        const targetTime = Math.max(0, audio.__pendingSeekRatio * (audio.duration - 0.05));
        audio.currentTime = targetTime;
        this._seekLockTime = targetTime;
        this._seekLockUntil = Date.now() + 1500;
        audio.__pendingSeekRatio = null;
        this.updateProgress();
    },

    scrubToPointer: function (e, track) {
        this.setProgressVisual(this.pointerRatio(e, track), this.getAudio());
    },

    setupProgressBar: function () {
        const track = document.getElementById('prog-bar-track');
        if (!track || track.__bound) return;
        track.__bound = true;

        track.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._scrubbing = true;
            track.setPointerCapture(e.pointerId);
            this.scrubToPointer(e, track);
        });
        track.addEventListener('pointermove', (e) => {
            if (!this._scrubbing) return;
            e.stopPropagation();
            this.scrubToPointer(e, track);
        });
        track.addEventListener('pointerup', (e) => {
            if (!this._scrubbing) return;
            e.stopPropagation();
            const ratio = this.pointerRatio(e, track);
            this.commitSeek(ratio);
            this._scrubbing = false;
            try { track.releasePointerCapture(e.pointerId); } catch (_) {}
        });
        track.addEventListener('pointercancel', (e) => {
            e.stopPropagation();
            this._scrubbing = false;
        });

        const audio = this.getAudio();
        if (audio && !audio.__progressHooked) {
            audio.__progressHooked = true;
            audio.addEventListener('timeupdate', () => {
                if (!this._scrubbing) this.updateProgress();
            });
            audio.addEventListener('loadedmetadata', () => {
                this.applyPendingSeek(audio);
                this.updateProgress();
            });
        }
    },

    // 点击左侧列表项或右侧切歌时触发
    select: function(idx, isAuto = false, isBacktracking = false) {

        this.loadGeneration++;
        const gen = this.loadGeneration;
        this._switchingTrack = true;
        this._endedHandledForGen = null;
        this._loopRestarting = false;
        this._userPaused = false;
        this._scrubbing = false;
        this.resetProgressUI();

        // 逻辑：手动点击切歌时同步曲库——但仅限点唱机页签，
        // 否则在其他页面用迷你控制台播放会把当前分类数据当成曲目
        if (!isAuto && document.querySelector('.tab-btn.active')?.innerText === '点唱机' && window.currentRawData) {
            this.playlist = [...window.currentRawData];
        }
        const data = this.playlist;
        if (!data[idx]) {
            this._switchingTrack = false;
            return;
        }

        const beginTrackLoad = () => {
            if (gen !== this.loadGeneration) return;
            // 如果不是在点击"上一首"（回溯），则将当前索引推入足迹栈
            if (!isBacktracking && this.currentIndex !== -1) {
                this.playStack.push(this.currentIndex);
                // 限制栈大小，防止内存占用过高（如记录最近50首）
                if (this.playStack.length > 50) this.playStack.shift();
            }

            this.currentIndex = idx;
            const audio = document.getElementById('global-audio-engine');
            const rawItem = data[idx];
            const songName = rawItem.标题 || rawItem.名称;

            // 曲名/日志写入的是全局共享的详情区 DOM，
            // 只有当前停留在点唱机页签时才允许写入，
            // 否则自动切歌会把音乐信息渲染到其他分类的详情页上
            const activeTab = document.querySelector('.tab-btn.active')?.innerText;
            if (activeTab === '点唱机') {
                // 强制覆盖顶部名称容器
                const detName = document.getElementById('det-name');
                if (detName) detName.innerText = songName;

                // UI 更新与打字机触发
                const titleElem = document.getElementById('playing-title');
                if (titleElem) titleElem.innerText = "TRACK: " + songName;
                // 更新曲目封面（有独立封面则显示，否则回落 default.jpg）
                this.updateCover(rawItem);
                // 同步分组按钮显示（点列表切歌时不重渲染面板，需手动刷新）
                this.syncGroupUI();
                this.syncFavUI();
                // 2. 核心：强制更新顶部那个显示"音乐点唱机"的容器
                const topBox = document.getElementById('item-title-box');
                if (topBox) topBox.innerText = songName;

                if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(this.buildTrackLog(rawItem));

                // 高亮左侧列表：按文件名匹配（分组置顶后位置索引会错位）
                document.querySelectorAll('#item-list .nav-item').forEach(li => {
                    li.classList.toggle('active', !!(li.__item && rawItem.文件名 && li.__item.文件名 === rawItem.文件名));
                });
            }

            this.initAudio();

            // 右下角 NOW PLAYING 指示器在任何页面都更新
            this.updateNowPlaying(songName);

            const startPlayback = () => {
                if (gen !== this.loadGeneration) return;
                audio.__pendingSeekRatio = null;
                const onMeta = () => {
                    if (gen !== this.loadGeneration) return;
                    this.applyPendingSeek(audio);
                    this.updateProgress();
                };
                audio.addEventListener('loadedmetadata', onMeta, { once: true });
                audio.load();
                this.initAudioContext();

                audio.play().then(() => {
                    if (gen !== this.loadGeneration) return;
                    this._autoFailCount = 0;
                    this._userPaused = false;
                    this._switchingTrack = false;
                    this.fade('in');
                    this.startAnimation();
                    this.updateButton(true);
                    this.applyPendingSeek(audio);
                    this.updateProgress();
                }).catch((e) => {
                    if (gen !== this.loadGeneration) return;
                    console.error('Playback failed:', e);
                    this.updateButton(false);
                    if (!isAuto) {
                        this._switchingTrack = false;
                        return;
                    }
                    this._autoFailCount = (this._autoFailCount || 0) + 1;
                    if (this._autoFailCount < Math.max(1, data.length)) {
                        this.next(true);
                    } else {
                        this._switchingTrack = false;
                    }
                });
            };

            this.loadTrackSrc(rawItem.文件名, gen).then(startPlayback);

            // 维护随机去重历史
            if (this.playMode === 2) {
                if (!this.history.includes(idx)) this.history.push(idx);
                if (this.history.length >= data.length) this.history = [idx];
            }
        };

        this.fade('out', beginTrackLoad);
    },

    // 构建曲目元数据日志（打字机内容）
    buildTrackLog: function (rawItem) {
        let logLines = [];
        if (rawItem.标题) {logLines.push(`>> 曲目: ${rawItem.标题}`);}
        if (rawItem.参与创作的艺术家) {logLines.push(`>> 作曲家: ${rawItem.参与创作的艺术家}`);}
        if (rawItem.唱片集) {logLines.push(`>> 专辑: ${rawItem.唱片集}`);}
        if (rawItem.流派) {logLines.push(`>> 类别: ${rawItem.流派}`);}
        if (rawItem.年) {logLines.push(`>> 发行: ${rawItem.年}`);}
        if (rawItem.比特率) {logLines.push(`>> 比特率: ${rawItem.比特率}`);}
        if (rawItem.频道) {logLines.push(`>> 频道: ${rawItem.频道}`);}
        if (rawItem.音频采样频率) {logLines.push(`>> 采样频率: ${rawItem.音频采样频率}`);}
        return logLines.join('\n');
    },

    // 按歌曲对象选播（列表分组打乱顺序后，用文件名定位，避免位置索引错位）
    selectByItem: function (item) {
        if (!item || !item.文件名) return;
        if (window.currentRawData && window.currentRawData.length) {
            this.playlist = [...window.currentRawData];
        } else if (!this.playlist.length) {
            return;
        }
        const idx = this.playlist.findIndex(p => p.文件名 === item.文件名);
        if (idx !== -1) this.select(idx, false, false);
    },

    // ===== 收藏（红心）功能：状态存 localStorage，键=文件名，不会被转换脚本覆盖 =====
    getFavs: function () {
        if (!this.__favs) {
            try {
                this.__favs = new Set(JSON.parse(localStorage.getItem('mm2r_fav_songs') || '[]'));
            } catch (e) {
                this.__favs = new Set();
            }
        }
        return this.__favs;
    },

    isFav: function (item) {
        return !!(item && item.文件名 && this.getFavs().has(item.文件名));
    },

    toggleFav: function () {
        if (this.currentIndex === -1 || !this.playlist.length) return;
        const item = this.playlist[this.currentIndex];
        if (!item || !item.文件名) return;
        const favs = this.getFavs();
        if (favs.has(item.文件名)) favs.delete(item.文件名);
        else favs.add(item.文件名);
        localStorage.setItem('mm2r_fav_songs', JSON.stringify([...favs]));
        persistJukeboxUserData();
        // 刷新左侧收藏分组（仅当停留在点唱机页签时列表存在）
        if (typeof window.renderMusicData === 'function' && window.currentRawData &&
            document.querySelector('.tab-btn.active')?.innerText === '点唱机') {
            window.renderMusicData(window.currentRawData);
            if (typeof window.bindJukeboxList === 'function') window.bindJukeboxList();
        }
        this.syncFavUI();
    },

    // ===== 自定义分组：分组名由用户创建，映射关系存 localStorage =====
    batchMode: false,
    batchSel: new Set(),

    // 批量分组模式：开启后点列表只勾选不播放，勾完用分组下拉框统一归组
    toggleBatchMode: function () {
        this.batchMode = !this.batchMode;
        if (!this.batchMode) this.batchSel.clear();
        this.syncBatchUI();
        // 重绘列表以切换点击行为（播放 ↔ 勾选）
        if (typeof window.renderMusicData === 'function' && window.currentRawData &&
            document.querySelector('.tab-btn.active')?.innerText === '点唱机') {
            window.renderMusicData(window.currentRawData);
            if (typeof window.bindJukeboxList === 'function') window.bindJukeboxList();
        }
    },

    toggleBatchItem: function (item) {
        if (!item || !item.文件名) return;
        if (this.batchSel.has(item.文件名)) this.batchSel.delete(item.文件名);
        else this.batchSel.add(item.文件名);
        document.querySelectorAll('#item-list .nav-item').forEach(li => {
            if (li.__item && li.__item.文件名 === item.文件名) {
                li.classList.toggle('batch-sel', this.batchSel.has(item.文件名));
            }
        });
        this.syncBatchUI();
    },

    clearBatchSel: function () {
        this.batchSel.clear();
        document.querySelectorAll('#item-list .nav-item.batch-sel').forEach(li => li.classList.remove('batch-sel'));
        this.syncBatchUI();
    },

    syncBatchUI: function () {
        const btn = document.getElementById('batch-btn');
        if (btn) {
            // 批量模式下按钮即“已选 N 首”，点击按钮本身 = 退出批量分组
            btn.innerText = this.batchMode ? `已选 ${this.batchSel.size} 首` : '批量分组';
            btn.classList.toggle('active', this.batchMode);
        }
    },

    getGroups: function () {
        if (!this.__groups) {
            try {
                this.__groups = JSON.parse(localStorage.getItem('mm2r_song_groups') || '{}');
            } catch (e) {
                this.__groups = {};
            }
        }
        return this.__groups;
    },

    assignGroup: function (name) {
        // 下拉框选“＋ 新建分组…”时用自定义终端弹窗命名（不用系统 prompt）
        if (name === '__new__') {
            if (typeof window.mmPrompt === 'function') {
                window.mmPrompt('输入分组名称：', '', v => {
                    if (v) window.jukeboxMgr.assignGroup(v);
                });
            } else {
                const v = prompt('输入分组名称：');
                if (v && v.trim()) window.jukeboxMgr.assignGroup(v.trim());
            }
            return;
        }
        // 目标歌曲：批量模式下为所有勾选曲目（勾选记录基于当前列表数据），否则为当前曲目
        const targets = [];
        if (this.batchMode && this.batchSel.size > 0) {
            (window.currentRawData || this.playlist).forEach(p => {
                if (this.batchSel.has(p.文件名)) targets.push(p);
            });
        } else {
            const cur = this.playlist[this.currentIndex];
            if (cur) targets.push(cur);
        }
        if (!targets.length) {
            // 没有可归组的歌曲，给出引导提示
            if (name && typeof window.mmAlert === 'function') {
                window.mmAlert(this.batchMode ? '请先勾选要归组的歌曲' : '请先选中一首歌曲，再将其归入分组', 'warning');
            }
            this.syncGroupUI();
            return;
        }
        const applyAssign = () => {
            const groups = this.getGroups();
            targets.forEach(item => {
                if (name) groups[item.文件名] = name;
                else delete groups[item.文件名]; // 选“未分组”= 移出分组
            });
            localStorage.setItem('mm2r_song_groups', JSON.stringify(groups));
            persistJukeboxUserData();
            // 批量归组完成后自动退出批量分组
            if (this.batchMode) {
                this.batchMode = false;
                this.batchSel.clear();
            }
            // 刷新左侧分组列表（仅当停留在点唱机页签时列表存在）
            if (typeof window.renderMusicData === 'function' && window.currentRawData &&
                document.querySelector('.tab-btn.active')?.innerText === '点唱机') {
                window.renderMusicData(window.currentRawData);
                if (typeof window.bindJukeboxList === 'function') window.bindJukeboxList();
            }
            this.syncBatchUI();
            this.syncGroupUI();
            this.syncFavUI();
        };

        // 批量模式下先弹窗确认是否执行分组（未分组 = 移出分组，措辞区分开）
        if (this.batchMode) {
            const confirmMsg = name
                ? `将已选 ${targets.length} 首歌曲归入「${name}」？`
                : `将已选 ${targets.length} 首歌曲移出分组（设为未分组）？`;
            if (typeof window.mmConfirm === 'function') {
                window.mmConfirm(confirmMsg, applyAssign);
            } else {
                applyAssign();
            }
        } else {
            applyAssign();
        }
    },

    // 自绘分组下拉列表：展开/收起（挂在 body 上避免被裁切）
    toggleGroupDD: function (e) {
        if (e) e.stopPropagation();
        const btn = document.getElementById('group-dd-btn');
        let list = document.getElementById('group-dd-list');
        if (!list) {
            list = document.createElement('div');
            list.id = 'group-dd-list';
            document.body.appendChild(list);
        }
        if (list.style.display === 'block') {
            list.style.display = 'none';
            return;
        }
        this.syncGroupUI(); // 重新填充选项并定位
        const r = btn.getBoundingClientRect();
        list.style.top = (r.bottom + 4) + 'px';
        list.style.right = Math.max(0, window.innerWidth - r.right) + 'px';
        list.style.left = 'auto';
        list.style.display = 'block';
    },

    syncGroupUI: function () {
        const btn = document.getElementById('group-dd-btn');
        if (!btn) return;
        const item = this.playlist[this.currentIndex];
        // 当前分组 = 用户端覆盖优先，其次数据“分组”字段（与列表分组逻辑一致）
        const cur = (item && item.文件名) ? (this.getGroups()[item.文件名] || item.分组 || '') : '';
        // 按钮显示当前分组
        btn.innerText = (cur || '分组') + ' ▾';
        btn.title = cur ? `当前分组：${cur}` : '把当前歌曲归入分组';

        // 自绘下拉列表选项：未分组 / 已有组名（含数据“分组”字段） / 新建
        let list = document.getElementById('group-dd-list');
        if (!list) {
            list = document.createElement('div');
            list.id = 'group-dd-list';
            document.body.appendChild(list);
        }
        const dataNames = (window.currentRawData || []).map(it => it.分组).filter(Boolean);
        const names = [...new Set([...Object.values(this.getGroups()), ...dataNames])];
        const opts = [{ v: '', t: '未分组' }]
            .concat(names.map(n => ({ v: n, t: n })))
            .concat([{ v: '__new__', t: '＋ 新建分组…' }]);
        list.innerHTML = opts.map(o =>
            `<div class="gdd-item${o.v === cur ? ' active' : ''}" data-v="${o.v}">${o.t}</div>`
        ).join('');
        list.querySelectorAll('.gdd-item').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                this.toggleGroupDD();
                this.assignGroup(el.dataset.v);
            };
        });
    },

    toggleMute: function () {
        if (this.muted) {
            this.muted = false;
            const restore = this.volumeBeforeMute !== undefined ? this.volumeBeforeMute : 1;
            this.setVolume(Math.round(restore * 100));
        } else {
            this.volumeBeforeMute = this.volume !== undefined ? this.volume : 1;
            this.muted = true;
            this.setVolume(0);
        }
    },

    syncVolToggleIcon: function (n) {
        const btn = document.getElementById('vol-toggle-btn');
        if (!btn) return;
        const muted = this.muted || n <= 0;
        btn.textContent = muted ? '🔇' : '🔊';
        btn.title = muted ? '取消静音' : '静音';
        btn.classList.toggle('muted', muted);
    },

    syncFavUI: function () {
        const fav = this.isFav(this.playlist[this.currentIndex]);
        const btn = document.getElementById('fav-btn');
        if (btn) btn.innerText = (fav ? '♥' : '♡') + ' 收藏';
        const npFav = document.getElementById('np-fav');
        if (npFav) {
            npFav.innerText = fav ? '♥' : '♡';
            npFav.style.color = fav ? '#ff4d6d' : '';
        }
    },

    collapseNowPlaying: function () {
        this.badgeCollapsed = true;
        this.syncNowPlayingVisibility();
    },

    expandNowPlaying: function () {
        this.badgeCollapsed = false;
        this.syncNowPlayingVisibility();
    },

    syncNowPlayingVisibility: function () {
        const badge = document.getElementById('now-playing-badge');
        const peek = document.getElementById('now-playing-peek');
        if (!badge || !peek) return;
        if (this.badgeCollapsed) {
            badge.style.display = 'none';
            badge.classList.remove('expanded');
            peek.style.display = 'flex';
        } else {
            peek.style.display = 'none';
            badge.style.display = 'flex';
        }
        this.applyMiniPlayerLayout();
    },

    // NOW PLAYING 指示器：主站右下角；地图页贴在 NAV 左侧
    // 悬停时向左侧依次滑出控制按键（模式/上一首/播放暂停/下一首/音量），
    // 鼠标离开后延迟收起，保证移动过程中不会中途消失
    updateNowPlaying: function (songName) {
        let badge = document.getElementById('now-playing-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'now-playing-badge';
            badge.innerHTML =
                '<div id="np-controls">' +
                '  <button id="np-mode" title="切换播放模式"></button>' +
                '  <button id="np-prev" title="上一首">⏮</button>' +
                '  <button id="np-play" title="播放/暂停">▶</button>' +
                '  <button id="np-next" title="下一首">⏭</button>' +
                '  <button id="np-fav" title="收藏/取消收藏">♡</button>' +
                '  <input type="range" id="np-vol" class="mm-vol-slider" min="0" max="100" value="100" title="音量">' +
                '  <span id="np-vol-val">100%</span>' +
                '</div>' +
                '<span class="np-icon">♪</span><span class="np-text"></span>' +
                '<button type="button" id="np-close" title="收起">✕</button>';
            badge.title = '正在播放 - 悬停调出控制台，点击曲名回到点唱机';
            document.body.appendChild(badge);

            const peek = document.createElement('button');
            peek.type = 'button';
            peek.id = 'now-playing-peek';
            peek.title = '展开正在播放';
            peek.innerHTML = '<span class="np-icon">♪</span>';
            peek.onclick = () => this.expandNowPlaying();
            document.body.appendChild(peek);

            // 悬停展开；离开后延迟 400ms 再收起，移回则取消收起
            badge.addEventListener('mouseenter', () => {
                clearTimeout(badge.__hideTimer);
                badge.classList.add('expanded');
            });
            badge.addEventListener('mouseleave', () => {
                badge.__hideTimer = setTimeout(() => badge.classList.remove('expanded'), 400);
            });

            document.getElementById('np-mode').onclick = () => this.toggleMode();
            document.getElementById('np-prev').onclick = () => this.prev();
            document.getElementById('np-play').onclick = () => this.toggle();
            document.getElementById('np-next').onclick = () => this.next();
            document.getElementById('np-fav').onclick = () => this.toggleFav();
            document.getElementById('np-vol').oninput = (e) => this.setVolume(e.target.value);
            document.getElementById('np-close').onclick = (e) => {
                e.stopPropagation();
                this.collapseNowPlaying();
            };

            // 跳转只绑定在曲名上，避免控制按键点击误触发导航
            const textEl = badge.querySelector('.np-text');
            textEl.style.cursor = 'pointer';
            textEl.onclick = () => {
                this.savePlaybackState();
                if (typeof window.loadCategory === 'function') {
                    window.loadCategory('点唱机');
                } else {
                    location.href = 'index.html?tab=' + encodeURIComponent('点唱机');
                }
            };
        }
        this.applyMiniPlayerLayout();
        // 同步模式与音量的显示状态
        const npMode = document.getElementById('np-mode');
        if (npMode) {
            npMode.innerText = this.modeLabels[this.playMode];
            npMode.title = 'MODE: ' + this.modeLabels[this.playMode];
        }
        const npVol = document.getElementById('np-vol');
        if (npVol) {
            npVol.classList.add('mm-vol-slider');
            const vol = Math.round((this.volume !== undefined ? this.volume : 1) * 100);
            npVol.value = vol;
            npVol.style.setProperty('--vol-pct', vol + '%');
            document.getElementById('np-vol-val').innerText = vol + '%';
        }
        this.syncFavUI();
        badge.querySelector('.np-text').innerText = songName || '';
        this.syncNowPlayingVisibility();
    },

    // 从其他页签切回点唱机时，恢复当前曲目的标题与日志（不重新播放）
    // 封面优先级：独立图片 > 音频内嵌 covr > default.jpg
    updateCover: async function (rawItem) {
        const art = document.getElementById('track-art');
        if (!art || !rawItem || !rawItem.文件名) return;
        this.__coverKey = rawItem.文件名;

        for (const coverName of this.sidecarCoverNames(rawItem.文件名)) {
            if (this.__coverKey !== rawItem.文件名) return;
            const url = await this.resolveMusicUrl(coverName);
            if (url && await this.probeImage(url)) {
                if (this.__coverKey === rawItem.文件名) art.src = url;
                return;
            }
        }

        if (this.__coverKey !== rawItem.文件名) return;
        if (await this.loadEmbeddedCover(rawItem)) return;

        if (this.__coverKey !== rawItem.文件名) return;
        art.src = this.defaultCoverUrl();
    },

    refreshJukeboxUI: function () {
        if (this.currentIndex === -1) return;
        const rawItem = this.playlist[this.currentIndex];
        if (!rawItem) return;
        const songName = rawItem.标题 || rawItem.名称;

        const detName = document.getElementById('det-name');
        if (detName) detName.innerText = songName;
        const titleElem = document.getElementById('playing-title');
        if (titleElem) titleElem.innerText = "TRACK: " + songName;
        this.updateCover(rawItem);
        this.syncGroupUI();
        this.syncFavUI();
        const topBox = document.getElementById('item-title-box');
        if (topBox) topBox.innerText = songName;

        if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(this.buildTrackLog(rawItem));

        // 高亮正在播放的曲目（按文件名匹配，分组置顶后位置会错位）
        const playingKey = rawItem.文件名;
        document.querySelectorAll('#item-list .nav-item').forEach(li => {
            li.classList.toggle('active', !!(playingKey && li.__item && li.__item.文件名 === playingKey));
        });

        const audio = document.getElementById('global-audio-engine');
        if (audio) this.updateButton(!audio.paused);
    },

    toggle: function() {
    const audio = document.getElementById('global-audio-engine');

    // 情况 A: 还没选歌，直接点开始
    if (this.currentIndex === -1) {
        if (!this.playlist.length) {
            // 从其他页面直接开始播放：先加载点唱机曲库
            fetch(encodeURI('data/点唱机.json'))
                .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                .then(raw => {
                    this.playlist = Array.isArray(raw) ? raw : (raw.data || []);
                    this.select(0, true);
                })
                .catch(e => {
                    // 网页版数据包通常不含 点唱机.json：给出界面反馈而非未处理 rejection
                    console.warn('点唱机曲库加载失败', e);
                    this.playlist = [];
                });
            return;
        }
        this.select(0, true);
        return;
    }

    // 情况 B: 正在播放 -> 准备暂停
    if (!audio.paused) {
        this._userPaused = true;
        // 强制先更新 UI，再执行淡出，增强交互响应速度
        this.updateButton(false);
        this.fade('out', () => {
            audio.pause();
            if (this.timer) cancelAnimationFrame(this.timer);
        });
    }
    // 情况 C: 已经暂停 -> 准备播放
    else {
        this._userPaused = false;
        this.updateButton(true);
        this.initAudio();
        audio.play().then(() => {
            this.fade('in');
            this.startAnimation();
        }).catch(e => {
            console.error("Playback failed:", e);
            this.updateButton(false);
        });
    }
},

    // 优化后的上一首逻辑
    prev: function() {
        const data = this.playlist;
        if (!data || data.length === 0) return;

        if (this.playStack.length > 0) {
            // 核心优化：从足迹栈中弹出最后一首歌
            const lastIdx = this.playStack.pop();
            // 传入 isBacktracking=true，防止这首歌又被推入栈导致死循环
            this.select(lastIdx, true, true);
        } else {
            // 如果没有历史记录（刚打开第一首），则按列表顺序前移
            const total = data.length;
            let prevIdx = (this.currentIndex - 1 + total) % total;
            this.select(prevIdx, true); // 传 true，防止覆盖列表
        }
    },

    updateProgress: function () {
        if (this._scrubbing) return;
        const audio = this.getAudio();
        const bar = document.getElementById('prog-bar-inner');
        const timeDisp = document.getElementById('time-display');
        if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return;

        if (this._seekLockTime != null && Date.now() < this._seekLockUntil) {
            const ratio = this._seekLockTime / audio.duration;
            if (bar) bar.style.width = (ratio * 100) + '%';
            if (timeDisp) {
                timeDisp.innerText = `${this.formatTime(this._seekLockTime)} / ${this.formatTime(audio.duration)}`;
            }
            if (Math.abs(audio.currentTime - this._seekLockTime) < 0.25) {
                this._seekLockTime = null;
            }
            return;
        }
        this._seekLockTime = null;

        const per = (audio.currentTime / audio.duration) * 100;
        if (bar) bar.style.width = per + '%';
        if (timeDisp) timeDisp.innerText = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`;
    },

    setVolume: function(val) {
        const n = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
        const audio = document.getElementById('global-audio-engine');
        if (audio) audio.volume = n / 100;
        this.volume = n / 100;
        if (n > 0) this.muted = false;

        const pct = n + '%';
        const volValue = document.getElementById('vol-value');
        if (volValue) volValue.innerText = pct;
        const npVolVal = document.getElementById('np-vol-val');
        if (npVolVal) npVolVal.innerText = pct;

        const volInput = document.getElementById('vol-control-input');
        const npVol = document.getElementById('np-vol');
        [volInput, npVol].forEach(el => {
            if (!el) return;
            if (el.value !== String(n)) el.value = n;
            el.style.setProperty('--vol-pct', n + '%');
        });
        this.syncVolToggleIcon(n);
    },

    formatTime: s => `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`,

    updateButton: function(isPlaying) {
        // 迷你控制台的播放/暂停图标（任何页面都同步）
        const npPlay = document.getElementById('np-play');
        if (npPlay) npPlay.innerText = isPlaying ? "❚❚" : "▶";

        const btn = document.getElementById('play-pause-btn');
        if (!btn) return;

        // 如果还没选歌，显示开始
        if (this.currentIndex === -1) {
            btn.innerHTML = "开始";
            return;
        }
        if (btn) {
        // 正常地播放/暂停状态切换
        btn.innerHTML = isPlaying ? "暂停播放" : "继续播放";
        btn.classList.toggle('active', isPlaying);
        if(isPlaying) btn.classList.add('playing'); else btn.classList.remove('playing');}
    },

    // 在 jukeboxMgr 对象中添加此方法
    updateBars: function() {
        const container = document.getElementById('v-canvas-container');
        if (!container) return;

        const containerWidth = container.clientWidth;
        // 设定你期望的"基础宽度"
        // 如果想要细密的，设为 4-6；如果想要粗犷的，设为 15-20
        const barBaseWidth = 15;
        const gap = 2;
        const count = Math.floor(containerWidth / (barBaseWidth + gap));

        let html = '';
        for (let i = 0; i < count; i++) {
            // flex: 1 是铺满全屏的核心，它会让 div 自动平分父级宽度
            html += `<div class="v-bar" style="flex: 1; background: #50ff7d; min-width: 2px;"></div>`;
        }
        container.innerHTML = html;
    },

    startAnimation: function() {
        if (this.timer) cancelAnimationFrame(this.timer);
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

        const renderFrame = () => {
            this.analyser.getByteFrequencyData(dataArray);
            const bars = document.querySelectorAll('.v-bar');
            const barCount = bars.length;
            if (barCount === 0) return;

            bars.forEach((bar, i) => {
                // 核心计算：将音频数据映射到当前的柱子索引上
                // 这样无论生成多少条，都能铺满整个频段
                const sampleIdx = Math.floor(i * (dataArray.length / barCount));
                let val = dataArray[sampleIdx];

                // 修改建议：
                // 增加第一个数值（如 180）会让频谱向上冲得更高
                // 增加第二个数值（如 15）会让没声音时也有一排整齐的小短杠
                const height = (val / 255) * 280 + 10;

                const hue = 140 - (val / 255) * 140;
                bar.style.height = `${height}px`;
                bar.style.background = `linear-gradient(to top, #50ff7d, hsl(${hue}, 100%, 50%))`;
                bar.style.boxShadow = `0 0 8px hsla(${hue}, 100%, 50%, 0.3)`;
            });

            this.updateProgress();
            this.timer = requestAnimationFrame(renderFrame);
        };
        renderFrame();
    }
}; // 这里之前缺失了闭合大括号
const jukeboxRenderer = {
    skin: "skin-jukebox",
    renderStats: function(item) {
        const mgr = window.jukeboxMgr;

        const playingItem = (window.jukeboxMgr.currentIndex !== -1) ?
                    window.jukeboxMgr.playlist[window.jukeboxMgr.currentIndex] : item;
        const currentName = playingItem ? (playingItem.标题 || playingItem.名称) : "SYSTEM_READY";
        // 同时手动刷一下顶栏（防止渲染器只管局部而没管顶栏）
        const topBox = document.getElementById('item-title-box');
        if (topBox && window.jukeboxMgr.currentIndex !== -1) topBox.innerText = currentName;
        // 由于左侧列表已经在 test.html 的 renderList 处理，这里只渲染右侧控制面板
        return `
        <div class="pro-player-console" style="grid-column: 1 / -1;gap: 10px;">
            <div class="monitor-layout">
                <div class="cover-frame">
                    <img id="track-art" src="music/default.png">
                    <div class="frame-glitch"></div>
                </div>
                <div class="monitor-section" style="flex:1; display: flex; align-items: center; justify-content: center; padding: 0 10px; position: relative;">
                    <div id="v-canvas-container" style="
                        display: flex; 
                        width: 100%;           /* 必须填满父级 */
                        height: 100%;          /* 必须填满父级 */
                        align-items: flex-end; /* 底部对齐 */
                        gap: 2px;              /* 条与条之间的细缝 */
                        padding: 0 5px;        /* 左右微调 */
                    ">
                    </div>
                    <div class="scan-line"></div>
                </div>
            </div>
            <div class="control-section">
                <div class="status-row">
                    <span class="tag">DECODING_REALTIME</span>
                    <span class="tag" style="color:#fff">METAL_MAX_AUDIO_V3</span>
                </div>
                <h2 id="playing-title" class="glitch-text">TRACK: ${currentName}</h2>
                <div class="playback-bar">
                    <div class="prog-bar-bg" id="prog-bar-track">
                        <div id="prog-bar-inner"></div>
                    </div>
                    <div id="time-display">00:00 / 00:00</div>
                </div>
                <div class="interaction-grid interaction-grid-single">
                    <div class="ctrl-row-main">
                        <button class="mm-btn" id="mode-btn" onclick="jukeboxMgr.toggleMode()">MODE: 列表循环</button>
                        <button class="mm-btn" id="fav-btn" onclick="jukeboxMgr.toggleFav()">♡ 收藏</button>
                        <button class="mm-btn" onclick="jukeboxMgr.prev()">上一首</button>
                        <button class="mm-btn active" id="play-pause-btn" onclick="jukeboxMgr.toggle()">
                            ${window.jukeboxMgr.currentIndex === -1 ? "开始" : (document.getElementById('global-audio-engine').paused ? "继续播放" : "暂停播放")}
                        </button>
                        <button class="mm-btn" onclick="jukeboxMgr.next()">下一首</button>
                        <button class="mm-btn" id="batch-btn" onclick="jukeboxMgr.toggleBatchMode()" title="勾选多首歌后统一归组">批量分组</button>
                        <button class="mm-btn" id="group-dd-btn" onclick="jukeboxMgr.toggleGroupDD(event)" title="把当前歌曲归入分组">分组 ▾</button>
                    </div>
                    <button type="button" class="mm-btn vol-mute-btn" id="vol-toggle-btn" onclick="jukeboxMgr.toggleMute()" title="静音" aria-label="静音">🔊</button>
                </div>
            </div>
        </div>`;
    },
    onUpdateVisual: function() {
    const audio = document.getElementById('global-audio-engine');
    const mgr = window.jukeboxMgr;

    // --- 新增：根据当前宽度生成 bar ---
    mgr.updateBars();
    // 同步收藏、分组与批量勾选控件状态
    mgr.syncFavUI();
    mgr.syncGroupUI();
    mgr.syncBatchUI();

    if (audio) {
        // 如果从未播放过，显示"开始"
        if (mgr.currentIndex === -1) {
            const btn = document.getElementById('play-pause-btn');
            if (btn) btn.innerHTML = "开始";
        } else {
            // 已经有歌在播了，根据播放状态显示 暂停/继续
            mgr.updateButton(!audio.paused);
        }

        if (!audio.paused) mgr.startAnimation();
    }

    mgr.setVolume(Math.round((mgr.volume !== undefined ? mgr.volume : 1) * 100));
    mgr.syncVolToggleIcon(Math.round((mgr.volume !== undefined ? mgr.volume : 1) * 100));
    mgr.setupProgressBar();
    mgr.updateProgress();
    // 预置默认封面，避免切歌瞬间裂图
    const art = document.getElementById('track-art');
    if (art && (!art.complete || art.naturalWidth === 0)) {
        art.src = mgr.defaultCoverUrl();
    }
    if (mgr.currentIndex >= 0) {
        const item = mgr.playlist[mgr.currentIndex];
        if (item) mgr.updateCover(item);
    }
    // --- 新增：监听窗口大小变化 ---
    window.onresize = () => mgr.updateBars();
}
};

if (typeof window.registerPageRenderer === 'function') {
    window.registerPageRenderer("点唱机", jukeboxRenderer);
}

// ===== 用户数据落盘：收藏/分组镜像到 用户数据\点唱机数据.json（与地图标注同模式，随用户数据迁移） =====
const JUKEBOX_STORE_FILE = '点唱机数据.json';
const JUKEBOX_SEEDED_KEY = 'mm2r_jukebox_file_seeded';

function jukeboxSnapshot() {
    let favs = [];
    let groups = {};
    try { favs = JSON.parse(localStorage.getItem('mm2r_fav_songs') || '[]'); } catch (e) {}
    try { groups = JSON.parse(localStorage.getItem('mm2r_song_groups') || '{}'); } catch (e) {}
    return { 收藏: favs, 分组: groups };
}

function persistJukeboxUserData() {
    if (!(window.__TAURI__ && window.__TAURI__.core)) return;
    window.__TAURI__.core.invoke('save_data', {
        name: JUKEBOX_STORE_FILE,
        data: JSON.stringify(jukeboxSnapshot(), null, '\t'),
    }).catch(e => console.warn('点唱机数据落盘失败', e));
}

async function loadJukeboxUserData() {
    if (!(window.__TAURI__ && window.__TAURI__.core)) return;
    let file = '';
    try {
        file = await window.__TAURI__.core.invoke('load_data', { name: JUKEBOX_STORE_FILE });
    } catch (e) {
        return;
    }
    const invalidateCaches = () => {
        if (window.jukeboxMgr) { window.jukeboxMgr.__favs = null; window.jukeboxMgr.__groups = null; }
        // 点唱机页签正开着时，重渲染列表使红心/分组状态即时生效
        if (typeof window.renderMusicData === 'function' && window.currentRawData &&
            document.querySelector('.tab-btn.active')?.innerText === '点唱机') {
            window.renderMusicData(window.currentRawData);
            if (typeof window.bindJukeboxList === 'function') window.bindJukeboxList();
        }
    };
    if (file && file.trim()) {
        try {
            const data = JSON.parse(file);
            if (Array.isArray(data.收藏)) {
                localStorage.setItem('mm2r_fav_songs', JSON.stringify(data.收藏));
            }
            if (data.分组 && typeof data.分组 === 'object' && !Array.isArray(data.分组)) {
                localStorage.setItem('mm2r_song_groups', JSON.stringify(data.分组));
            }
            localStorage.setItem(JUKEBOX_SEEDED_KEY, '1');
            invalidateCaches();
        } catch (e) {
            console.warn('点唱机数据解析失败', e);
        }
        return;
    }
    if (!localStorage.getItem(JUKEBOX_SEEDED_KEY)) {
        // 一次性升级：旧版收藏/分组只存在 localStorage，首次落盘时迁移进来
        const snap = jukeboxSnapshot();
        const hasData = (Array.isArray(snap.收藏) && snap.收藏.length > 0)
            || (snap.分组 && Object.keys(snap.分组).length > 0);
        if (hasData) {
            localStorage.setItem(JUKEBOX_SEEDED_KEY, '1');
            persistJukeboxUserData();
        }
        return;
    }
    // 文件为准：已启用落盘后，文件没了 = 用户清空了收藏/分组
    localStorage.removeItem('mm2r_fav_songs');
    localStorage.removeItem('mm2r_song_groups');
    invalidateCaches();
}

function bootJukeboxEngine() {
    const mgr = window.jukeboxMgr;
    if (!mgr) return;
    loadJukeboxUserData();
    if (mgr.bindTrackEndHandler) mgr.bindTrackEndHandler();
    // 嵌入主站 BS 面板时（map.html 位于 iframe 内）：音乐由主站点唱机单一来源提供。
    // 这里若恢复播放会与主站双路叠加；且 currentIndex=-1 时持久化监听会误删主站存的恢复键
    if (window.parent && window.parent !== window) return;
    if (mgr.bindPlaybackPersistence) mgr.bindPlaybackPersistence();
    if (mgr.restorePlaybackState) mgr.restorePlaybackState();
}

document.addEventListener('DOMContentLoaded', bootJukeboxEngine);
if (document.readyState !== 'loading') {
    bootJukeboxEngine();
}