/**
 * 47都道府県耐久配信システム
 * - エリア別カラー (mapData.json 参照)
 * - ドボン時の画面割れ・音声演出
 */

const DEFAULT_COLOR = '#ff79c6';

const State = {
    SERVER_PATH: 'service.meigetsu.jp/prefecture_challenge',
    params: new URLSearchParams(window.location.search),
    sessionId: null,
    oneCommeHost: '127.0.0.1',
    socket: null,
    oneCommeSubscriberId: null,
    oneCommeScriptPromise: null,
    mapData: [],
    regions: [],
    isAccepting: true,
    urlCopyState: 'idle',
    urlCopyResetTimer: null,
    oneCommeRetryTimer: null,

    // --- 音響設定 ---
    se: {
        dedeen: new Audio('assets/sounds/dedeen.mp3'),
    },

    // --- 演出・UI状態 ---
    isOutEffect: false, // ドボン(デデーン)中
    isOutMapRevealed: false,
    displayOutName: '',

    outTimer: null,
    crackRevealTimer: null,
    currentVoice: null,
    voiceVoxUrl: 'http://localhost:11021',

    // 配信者情報
    inputStreamerName: '',
    inputReadingLast: '',
    inputReadingFirst: '',
    streamerName: '',
    streamerReading: '',

    async init() {
        this.sessionId = this.params.get('session');
        this.oneCommeHost = this.params.get('onecomme') || '127.0.0.1';
        this.streamerName = this.params.get('name') || '';
        this.streamerReading = this.params.get('reading') || '';

        try {
            this.mapData = await m.request({ url: 'data/mapData.json' });
        } catch (e) {
            console.error('Data Load Error', e);
        }

        if (this.sessionId && this.streamerName) {
            const pInterval = this.params.get('interval') || 1000;
            this.startSystem(parseInt(pInterval));
        }
    },

    async startSystem(directInterval = null) {
        if (!this.streamerName) {
            this.streamerName = this.inputStreamerName.trim();
            this.streamerReading = `${this.inputReadingLast.trim()} ${this.inputReadingFirst.trim()}`;
        }

        if (!this.sessionId) {
            try {
                const res = await m.request({
                    method: 'GET',
                    url: `https://${this.SERVER_PATH}/api/session/new`,
                });
                this.sessionId = res.sessionId;
            } catch (e) {
                console.error('Session creation failed', e);
                m.redraw();
                return;
            }
        }

        const finalMs = directInterval || this.params.get('interval') || 1000;
        window.history.pushState(
            {},
            '',
            `?session=${this.sessionId}&name=${encodeURIComponent(this.streamerName)}&reading=${encodeURIComponent(this.streamerReading)}&interval=${finalMs}`
        );

        this.connectMain();
        this.startOneCommeSdk(finalMs);
        m.redraw();
    },

    async copyCurrentUrl() {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(window.location.href);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = window.location.href;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                const copied = document.execCommand('copy');
                textarea.remove();
                if (!copied) throw new Error('Copy command failed');
            }
            this.urlCopyState = 'copied';
        } catch (error) {
            console.warn('URL copy failed', error);
            this.urlCopyState = 'failed';
        }

        if (this.urlCopyResetTimer) clearTimeout(this.urlCopyResetTimer);
        this.urlCopyResetTimer = setTimeout(() => {
            this.urlCopyState = 'idle';
            m.redraw();
        }, 1800);
        m.redraw();
    },

    connectMain() {
        const wsUrl = `wss://${this.SERVER_PATH}/ws/${this.sessionId}`;
        const socket = new WebSocket(wsUrl);

        socket.addEventListener('message', event => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'INIT' || data.type === 'DOBON_RESET') {
                    State.regions = data.regions;
                    if (data.type === 'DOBON_RESET') {
                        State.playOutSequence();
                    }
                } else if (data.type === 'SUCCESS') {
                    State.localUpdate(data.areaId, data.prefName, data.isCleared);
                }
                m.redraw();
            } catch (e) {
                console.error('WS Data Error', e);
            }
        });

        socket.addEventListener('open', () => {
            socket.send(
                JSON.stringify({
                    type: 'CLIENT_START',
                    name: State.streamerName,
                    reading: State.streamerReading,
                })
            );
        });

        socket.addEventListener('close', () => setTimeout(() => State.connectMain(), 3000));
        this.socket = socket;
    },

    stopAllEffects() {
        if (this.outTimer) clearTimeout(this.outTimer);
        if (this.crackRevealTimer) clearTimeout(this.crackRevealTimer);
        Object.values(this.se).forEach(s => {
            s.pause();
            s.currentTime = 0;
        });
        if (this.currentVoice) this.currentVoice.pause();
        this.isOutEffect = false;
        this.isOutMapRevealed = false;
        m.redraw();
    },

    async playOutSequence() {
        this.stopAllEffects();
        this.isOutEffect = true;
        this.displayOutName = this.streamerName;
        m.redraw();
        this.se.dedeen.play();
        this.crackRevealTimer = setTimeout(() => {
            this.isOutMapRevealed = true;
            m.redraw();
        }, 1800);
        try {
            const text = `${this.streamerReading}、アウト。`;
            const query = await m.request({
                method: 'POST',
                url: `${this.voiceVoxUrl}/audio_query`,
                params: { speaker: 2, text: text },
            });
            const voiceRes = await fetch(`${this.voiceVoxUrl}/synthesis?speaker=2`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(query),
            });
            const url = URL.createObjectURL(await voiceRes.blob());
            this.outTimer = setTimeout(() => {
                this.currentVoice = new Audio(url);
                this.currentVoice.play();
            }, 1200);
        } catch (e) {
            console.warn('VOICEVOX offline');
        }
        this.outTimer = setTimeout(() => {
            this.isOutEffect = false;
            m.redraw();
        }, 5000);
    },

    loadOneCommeSdk() {
        const currentSdk = window.OneSDK?.subscribe ? window.OneSDK : window.OneSDK?.default;
        if (currentSdk) return Promise.resolve(currentSdk);
        if (this.oneCommeScriptPromise) return this.oneCommeScriptPromise;

        this.oneCommeScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `http://${this.oneCommeHost}:11180/templates/preset/__origin/js/onesdk.js`;
            script.async = true;
            script.onload = () => {
                const loadedSdk = window.OneSDK?.subscribe ? window.OneSDK : window.OneSDK?.default;
                if (loadedSdk) {
                    resolve(loadedSdk);
                } else {
                    this.oneCommeScriptPromise = null;
                    reject(new Error('OneSDK is not available'));
                }
            };
            script.onerror = () => {
                this.oneCommeScriptPromise = null;
                reject(new Error('OneSDK load failed'));
            };
            document.head.appendChild(script);
        });

        return this.oneCommeScriptPromise;
    },

    async startOneCommeSdk(interval) {
        const sdkInterval = parseInt(interval, 10) || 1000;

        try {
            const sdk = await this.loadOneCommeSdk();

            if (this.oneCommeSubscriberId !== null) {
                sdk.unsubscribe(this.oneCommeSubscriberId);
                this.oneCommeSubscriberId = null;
            }

            await sdk.setup({
                protocol: 'local',
                host: this.oneCommeHost,
                port: 11180,
                mode: 'diff',
                disabledDelay: true,
                intervalTime: sdkInterval,
                requestInterval: sdkInterval,
                commentLimit: 100,
                permissions: ['comments'],
            });

            this.oneCommeSubscriberId = sdk.subscribe({
                action: 'comments',
                callback: comments => this.forwardOneCommeComments(comments),
            });

            await sdk.connect();
        } catch (e) {
            console.warn('OneSDK connection failed', e);
            this.oneCommeScriptPromise = window.OneSDK ? this.oneCommeScriptPromise : null;
            if (this.oneCommeRetryTimer) clearTimeout(this.oneCommeRetryTimer);
            this.oneCommeRetryTimer = setTimeout(() => this.startOneCommeSdk(interval), 5000);
        }
    },

    forwardOneCommeComments(comments) {
        if (!this.isAccepting || !this.socket || this.socket.readyState !== 1 || !Array.isArray(comments)) return;

        const rawComments = comments
            .map(c => ({
                id: c?.data?.id || c?.id,
                comment: c?.data?.comment || '',
                userId: c?.data?.userId || c?.id || 'UNKNOWN',
            }))
            .filter(c => c.id && c.comment);

        if (rawComments.length === 0) return;

        this.socket.send(
            JSON.stringify({
                type: 'RAW_COMMENTS',
                comments: rawComments,
            })
        );
    },

    localUpdate(areaId, prefName, isCleared) {
        const r = this.regions.find(reg => reg.id === areaId);
        if (r) {
            r.prefs = r.prefs.filter(p => p !== prefName);
            r.isCleared = isCleared;
            if (isCleared) r.prefs = [];
        }
    },
};

// --- View Components ---

const MapView = {
    view: () =>
        m('svg#MAP_JAPAN', { viewBox: '0 0 1024 1024' }, [
            m('g#GROUND', { strokeLinejoin: 'round', strokeWidth: '1.1', stroke: '#111', fill: '#fff' }, [
                State.mapData.map(group => {
                    const sr = State.regions.find(r => r.id === group.regionId);
                    const areaFillColor = group.color || DEFAULT_COLOR;
                    return m(
                        'g',
                        { class: sr?.isCleared ? 'region-cleared' : '' },
                        group.prefs.map(p => {
                            const isFilled = sr && (sr.isCleared || !sr.prefs.includes(p.id));
                            return m('path.prefecture-path', {
                                key: p.id,
                                d: p.d,
                                transform: p.transform || '',
                                style: { fill: isFilled ? areaFillColor : '#fff' },
                                onclick: () =>
                                    State.socket.send(
                                        JSON.stringify({
                                            type: 'SELECT_PREF',
                                            userId: 'MANUAL_' + Math.random(),
                                            prefName: p.id,
                                        })
                                    ),
                            });
                        })
                    );
                }),
                m('path#ARC', {
                    d: 'M420 0 L420 530 L0 530',
                    fill: 'none',
                    stroke: '#aaa',
                    strokeWidth: '5',
                    strokeDasharray: '10,5',
                }),
            ]),
        ]),
};

const MainView = {
    view: () =>
        m('.main-layout', [
            m('header', [
                m('h1', '47都道府県耐久'),
                m('.game-controls', [
                    m(
                        'button.url-copy-btn',
                        { type: 'button', onclick: () => State.copyCurrentUrl() },
                        State.urlCopyState === 'copied'
                            ? 'コピーしました'
                            : State.urlCopyState === 'failed'
                              ? 'コピーできません'
                              : '現在のURLをコピー'
                    ),
                    m(
                        'button.accept-toggle',
                        {
                            type: 'button',
                            class: State.isAccepting ? 'is-active' : '',
                            onclick: () => (State.isAccepting = !State.isAccepting),
                        },
                        State.isAccepting ? '自動取得ON' : '停止中'
                    ),
                ]),
            ]),
            m(MapView),
            State.isOutEffect
                ? m(
                      `.out-overlay.crack-overlay${State.isOutMapRevealed ? '.map-revealed' : ''}`,
                      { onclick: () => State.stopAllEffects() },
                      [
                      m('.crack-flash'),
                      m('.crack-web'),
                      m(
                          '.shatter-field',
                          Array.from({ length: 12 }, (_, i) => m(`.glass-shard.shard-${i + 1}`))
                      ),
                      m('.out-box.crack-caption', [
                          m('h1.out-name', State.displayOutName),
                          m('h1.out-text', 'OUT'),
                      ]),
                      ]
                  )
                : null,
        ]),
};

const SetupView = {
    view: () =>
        m(
            '.setup-container',
            m('.setup-card', [
                m('h2', '47都道府県耐久設定'),
                m('.form-group', [
                    m('label', '配信者名'),
                    m('input.text-input[type=text]', {
                        placeholder: '明月花子',
                        oninput: e => (State.inputStreamerName = e.target.value),
                    }),
                ]),
                m('.form-group', [
                    m('label', 'よみがな'),
                    m('.input-row', [
                        m('input.text-input[type=text]', {
                            placeholder: 'めいげつ',
                            oninput: e => (State.inputReadingLast = e.target.value),
                        }),
                        m('input.text-input[type=text]', {
                            placeholder: 'はなこ',
                            oninput: e => (State.inputReadingFirst = e.target.value),
                        }),
                    ]),
                ]),
                m(
                    'button.start-btn',
                    {
                        disabled: !State.inputStreamerName || !State.inputReadingLast || !State.inputReadingFirst,
                        onclick: () => State.startSystem(),
                    },
                    '開始'
                ),
            ])
        ),
};

m.mount(document.getElementById('app'), {
    oninit: () => State.init(),
    view: () => (State.sessionId && State.socket ? m(MainView) : m(SetupView)),
});
