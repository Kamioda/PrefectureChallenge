/**
 * 47都道府県耐久配信システム v1.2
 * - mapData.json の color フィールドを参照
 * - OUT演出キャンセル機能搭載
 */

const DEFAULT_COLOR = '#ff79c6'; // 色指定がない時のデフォルト（ピンク）

const State = {
    SERVER_PATH: 'service.meigetsu.jp/prefecture_challenge',
    params: new URLSearchParams(window.location.search),
    sessionId: null,
    oneCommeHost: '127.0.0.1',
    socket: null,
    mapData: [],
    regions: [],
    currentQuiz: null,
    statusMessage: 'セットアップ完了後に開始してください',
    isAccepting: true,
    pollingTimer: null,

    // 演出管理
    outTimer: null,
    currentVoice: null,
    isOutEffect: false,
    displayOutName: '',
    dedeenSE: new Audio('assets/sounds/dedeen.mp3'),
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
            this.mapData = await m.request({
                method: 'GET',
                url: 'data/mapData.json',
            });
        } catch (e) {
            console.error('Map Load Error', e);
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
                this.statusMessage = 'エラー: セッション発行失敗';
                m.redraw();
                return;
            }
        }

        let finalMs = directInterval || (this.params.get('interval') || 1000);
        window.history.pushState({}, '', `?session=${this.sessionId}&name=${encodeURIComponent(this.streamerName)}&reading=${encodeURIComponent(this.streamerReading)}&interval=${finalMs}`);

        this.connectMain();
        this.startOneCommePolling(finalMs);
        this.statusMessage = 'システム稼働中';
        m.redraw();
    },

    connectMain() {
        const wsUrl = `wss://${this.SERVER_PATH}/ws/${this.sessionId}`;
        const socket = new WebSocket(wsUrl);

        socket.addEventListener('message', event => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'INIT' || data.type === 'UPDATE_MAP' || data.type === 'DOBON_RESET') {
                    State.regions = data.regions;
                    if (data.type === 'DOBON_RESET') {
                        State.statusMessage = `【ドボン】${data.prefName}でリセット！`;
                        State.playOutSequence();
                    }
                } else if (data.type === 'SUCCESS') {
                    State.statusMessage = `${data.prefName} 達成！`;
                    State.localUpdate(data.areaId, data.prefName, data.isCleared);
                } else if (data.type === 'QUIZ_DATA') {
                    State.currentQuiz = data.quiz;
                }
                m.redraw();
            } catch (e) { console.error('WS Data Error', e); }
        });

        socket.addEventListener('open', () => {
            socket.send(JSON.stringify({
                type: 'CLIENT_START',
                name: State.streamerName,
                reading: State.streamerReading,
            }));
        });

        socket.addEventListener('close', () => {
            setTimeout(() => State.connectMain(), 3000);
        });

        this.socket = socket;
    },

    // OUT演出停止
    stopOutEffect() {
        if (this.outTimer) clearTimeout(this.outTimer);
        this.dedeenSE.pause();
        this.dedeenSE.currentTime = 0;
        if (this.currentVoice) {
            this.currentVoice.pause();
            this.currentVoice = null;
        }
        this.isOutEffect = false;
        m.redraw();
    },

    async playOutSequence() {
        this.stopOutEffect();
        this.isOutEffect = true;
        this.displayOutName = this.streamerName;
        m.redraw();

        this.dedeenSE.play();

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
        } catch (e) { console.warn('VOICEVOX offline'); }

        this.outTimer = setTimeout(() => this.stopOutEffect(), 5000);
    },

    startOneCommePolling(interval) {
        if (this.pollingTimer) clearInterval(this.pollingTimer);
        this.pollingTimer = setInterval(async () => {
            if (!this.isAccepting || !this.socket || this.socket.readyState !== 1) return;
            try {
                const res = await m.request({
                    method: 'GET',
                    url: `http://${this.oneCommeHost}:11180/api/comments`,
                    params: { limit: 100 },
                });
                if (res && res.length > 0) {
                    this.socket.send(JSON.stringify({
                        type: 'RAW_COMMENTS',
                        comments: res.map(r => ({ id: r.data.id, comment: r.data.comment, userId: r.data.userId })),
                    }));
                }
            } catch (e) {}
        }, interval);
    },

    localUpdate(areaId, prefName, isCleared) {
        const r = this.regions.find(reg => reg.id === areaId);
        if (r) {
            r.prefs = r.prefs.filter(p => p !== prefName);
            r.isCleared = isCleared;
        }
    },
};

// --- MapView (色参照を修正) ---
const MapView = {
    view: () =>
        m('svg#MAP_JAPAN', { viewBox: '0 0 1024 1024' }, [
            m('g#GROUND', { strokeLinejoin: 'round', strokeWidth: '1.1', stroke: '#111', fill: '#fff' }, [
                State.mapData.map((group) => {
                    const sr = State.regions.find(r => r.id === group.regionId);
                    // ★ JSONの color を参照。なければデフォルト色
                    const areaFillColor = group.color || DEFAULT_COLOR;
                    
                    return m('g', { class: sr?.isCleared ? 'region-cleared' : '' },
                        group.prefs.map(p => {
                            const isFilled = sr && !sr.prefs.includes(p.id);
                            return m('path.prefecture-path', {
                                key: p.id,
                                d: p.d,
                                transform: p.transform || '',
                                // ★ 直接Styleで色を指定
                                style: { fill: isFilled ? areaFillColor : '#fff' },
                                class: isFilled ? 'filled' : '',
                                onclick: () => State.socket.send(JSON.stringify({
                                    type: 'SELECT_PREF',
                                    userId: 'MANUAL_' + Math.random(),
                                    prefName: p.id,
                                })),
                            });
                        })
                    );
                }),
                m('path#ARC', { d: 'M420 0 L420 530 L0 530', fill: 'none', stroke: '#aaa', strokeWidth: '5', strokeDasharray: '10,5' }),
            ]),
        ]),
};

// --- View 構成 (変更なし) ---
const SetupView = {
    view: () => m('.setup-container', m('.setup-card', [
        m('h2', '47都道府県耐久設定'),
        m('.form-group', [m('label', '配信者名'), m('input.text-input[type=text]', { oninput: e => State.inputStreamerName = e.target.value })]),
        m('.form-group', [m('label', 'よみがな'), m('.input-row', [
            m('input.text-input[type=text]', { placeholder: '名字', oninput: e => State.inputReadingLast = e.target.value }),
            m('input.text-input[type=text]', { placeholder: '名前', oninput: e => State.inputReadingFirst = e.target.value }),
        ])]),
        m('button.start-btn', {
            disabled: !State.inputStreamerName || !State.inputReadingLast || !State.inputReadingFirst,
            onclick: () => State.startSystem()
        }, 'チャレンジ開始')
    ]))
};

const MainView = {
    view: () => m('.main-layout', [
        m('header', { style: 'display:flex; justify-content:space-between; padding:10px; background:#111; border-bottom:2px solid #ff79c6;' }, [
            m('h1', { style: 'margin:0; font-size:18px; color:#ff79c6;' }, '47都道府県耐久'),
            m('button', {
                onclick: () => State.isAccepting = !State.isAccepting,
                style: `border:none; border-radius:4px; padding:4px 10px; background:${State.isAccepting ? '#ff79c6' : '#444'}; color:white;`
            }, State.isAccepting ? '自動取得ON' : '停止中')
        ]),
        m(MapView),
        State.currentQuiz ? m('.quiz-overlay', m('.quiz-card', [
            m('h3', 'AI救済クイズ！'),
            m('p', State.currentQuiz.question),
            State.currentQuiz.options.map((o, i) => m('button', {
                onclick: () => {
                    if (i === State.currentQuiz.answerIndex) State.statusMessage = '回避成功！';
                    State.currentQuiz = null;
                }
            }, o))
        ])) : null,
        State.isOutEffect ? m('.out-overlay', { onclick: () => State.stopOutEffect() }, [
            m('.out-box', [
                m('h1.out-name', State.displayOutName),
                m('h1.out-text', 'OUT !!'),
                m('p', { style: 'color: yellow;' }, 'CLICK TO SKIP')
            ]),
        ]) : null,
    ])
};

m.mount(document.getElementById('app'), {
    oninit: () => State.init(),
    view: () => (State.sessionId && State.socket ? m(MainView) : m(SetupView)),
});
