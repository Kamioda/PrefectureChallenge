/**
 * 47都道府県耐久配信システム v1.0
 * Frontend: JavaScript (Mithril.js)
 */

const State = {
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

    // 入力用バッファ
    inputSessionId: '',
    inputInterval: 1,
    inputUnit: 'sec',
    inputStreamerName: '', // 表示名
    inputReadingLast: '', // よみがな（名字）
    inputReadingFirst: '', // よみがな（名前）

    // 確定情報
    streamerName: '',
    streamerReading: '', // 名字と名前をスペースで結合したもの
    isOutEffect: false,
    displayOutName: '',
    dedeenSE: new Audio('assets/sounds/dedeen.mp3'),
    voiceVoxUrl: 'http://localhost:11021',
    async init() {
        this.sessionId = this.params.get('session');
        this.oneCommeHost = this.params.get('onecomme') || '127.0.0.1';
        this.streamerName = this.params.get('name') || '';
        this.streamerReading = this.params.get('reading') || '';

        try {
            // 地図のパスデータをロード
            this.mapData = await m.request({ method: 'GET', url: `data/mapData.json` });
        } catch (e) {
            console.error('Map Load Error', e);
        }

        // URLパラメータに情報があれば自動復帰
        if (this.sessionId && this.streamerName) {
            const pInterval = this.params.get('interval') || 1000;
            this.startSystem(parseInt(pInterval));
        }
    },

    async startSystem(directInterval = null) {
        // 1. 表示名と読み仮名の確定（名字と名前の間にスペースを挟む）
        if (!this.streamerName) {
            this.streamerName = this.inputStreamerName.trim();
            this.streamerReading = `${this.inputReadingLast.trim()} ${this.inputReadingFirst.trim()}`;
        }

        // 2. セッションIDの確定
        if (!this.sessionId) {
            if (this.inputSessionId.trim() !== '') {
                this.sessionId = this.inputSessionId.trim();
            } else {
                try {
                    const res = await m.request({ method: 'GET', url: `api/session/new` });
                    this.sessionId = res.sessionId;
                } catch (e) {
                    this.statusMessage = 'エラー: セッションの発行に失敗しました';
                    m.redraw();
                    return;
                }
            }
        }

        let finalMs = directInterval || (this.inputUnit === 'sec' ? this.inputInterval * 1000 : this.inputInterval);

        // URLパラメータを更新
        window.history.pushState(
            {},
            '',
            `./?session=${this.sessionId}&name=${encodeURIComponent(this.streamerName)}&reading=${encodeURIComponent(this.streamerReading)}&interval=${finalMs}`
        );

        this.connectMain();
        this.startOneCommePolling(finalMs);
        this.statusMessage = 'システム稼働中';
        m.redraw();
    },

    connectMain() {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        this.socket = new WebSocket(`${protocol}://${window.location.host}${window.location.pathname.replace(/\/[^\/]*$/, '')}/ws/${this.sessionId}`);

        this.socket.onopen = () => {
            // サーバーに名前とよみがな（スペース入り）を登録
            this.socket.send(
                JSON.stringify({
                    type: 'CLIENT_START',
                    name: this.streamerName,
                    reading: this.streamerReading,
                })
            );
        };

        this.socket.onmessage = event => {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'INIT':
                case 'UPDATE_MAP':
                case 'DOBON_RESET':
                    this.regions = data.regions;
                    if (data.type === 'DOBON_RESET') {
                        this.statusMessage = `【ドボン】${data.prefName}でリセット！`;
                        this.playOutSequence();
                    }
                    break;
                case 'SUCCESS':
                    this.statusMessage = `${data.prefName} 達成！`;
                    this.localUpdate(data.areaId, data.prefName, data.isCleared);
                    break;
                case 'QUIZ_DATA':
                    this.currentQuiz = data.quiz;
                    break;
            }
            m.redraw();
        };
    },

    async playOutSequence() {
        this.isOutEffect = true;
        this.displayOutName = this.streamerName;
        m.redraw();
        await this.dedeenSE.play();
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
            const blob = await voiceRes.blob();
            const url = URL.createObjectURL(blob);
            setTimeout(() => {
                new Audio(url).play();
            }, 1200);
        } catch (e) {
            console.warn('VOICEVOX offline');
        }
        setTimeout(() => {
            this.isOutEffect = false;
            m.redraw();
        }, 5000);
    },

    startOneCommePolling(interval) {
        if (this.pollingTimer) clearInterval(this.pollingTimer);
        const fetchComments = async () => {
            if (!this.isAccepting || !this.socket || this.socket.readyState !== 1) return;
            try {
                const res = await m.request({
                    method: 'GET',
                    url: `http://${this.oneCommeHost}:11180/api/comments`,
                    params: { limit: 100 },
                });
                if (res && res.length > 0) {
                    this.socket.send(
                        JSON.stringify({
                            type: 'RAW_COMMENTS',
                            comments: res.map(r => ({ id: r.data.id, comment: r.data.comment, userId: r.data.userId })),
                        })
                    );
                }
            } catch (e) {}
        };
        this.pollingTimer = setInterval(fetchComments, interval);
    },

    localUpdate(areaId, prefName, isCleared) {
        const r = this.regions.find(reg => reg.id === areaId);
        if (r) {
            r.prefs = r.prefs.filter(p => p !== prefName);
            r.isCleared = isCleared;
        }
    },
};

const MapView = {
    view: () =>
        m('svg#MAP_JAPAN', { viewBox: '0 0 1024 1024' }, [
            m('g#GROUND', { strokeLinejoin: 'round', strokeWidth: '1.1', stroke: '#111', fill: '#fff' }, [
                State.mapData.map(group => {
                    const sr = State.regions.find(r => r.id === group.regionId);
                    return m(
                        'g',
                        { class: sr?.isCleared ? 'region-cleared' : '' },
                        group.prefs.map(p => {
                            const isFilled = sr && !sr.prefs.includes(p.id);
                            return m('path.prefecture-path', {
                                key: p.id,
                                d: p.d,
                                transform: p.transform || '',
                                class: isFilled ? `filled area-${group.regionId}` : '',
                                onclick: () =>
                                    State.socket.send(
                                        JSON.stringify({
                                            type: 'SELECT_PREF',
                                            userId: 'MANUAL',
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

const SetupView = {
    view: () =>
        m(
            '.setup-container',
            m('.setup-card', [
                m('h2', '47都道府県耐久設定'),
                m('.form-group', [
                    m('label', 'セッションID (継続時は入力)'),
                    m('input.text-input[type=text]', {
                        value: State.inputSessionId,
                        oninput: e => (State.inputSessionId = e.target.value),
                    }),
                ]),
                m('.form-group', [
                    m('label', '配信者名 (表示用)'),
                    m('input.text-input[type=text]', {
                        placeholder: '例: 桜羽ありす',
                        oninput: e => (State.inputStreamerName = e.target.value),
                    }),
                ]),
                m('.form-group', [
                    m('label', 'よみがな (名字 / 名前)'),
                    m('.input-row', [
                        m('input.text-input[type=text]', {
                            placeholder: 'さくらは',
                            oninput: e => (State.inputReadingLast = e.target.value),
                        }),
                        m('input.text-input[type=text]', {
                            placeholder: 'ありす',
                            oninput: e => (State.inputReadingFirst = e.target.value),
                        }),
                    ]),
                ]),
                m('.form-group', [
                    m('label', '取得間隔'),
                    m('.input-row', [
                        m('input.num-input[type=number]', {
                            value: State.inputInterval,
                            oninput: e => (State.inputInterval = e.target.value),
                        }),
                        m('select.unit-select', { onchange: e => (State.inputUnit = e.target.value) }, [
                            m('option[value=sec]', '秒'),
                            m('option[value=ms]', 'ミリ秒'),
                        ]),
                    ]),
                ]),
                m(
                    'button.start-btn',
                    {
                        disabled: !State.inputStreamerName || !State.inputReadingLast || !State.inputReadingFirst,
                        onclick: () => State.startSystem(),
                    },
                    'チャレンジ開始'
                ),
            ])
        ),
};

const MainView = {
    view: () =>
        m('.main-layout', [
            m(
                'header',
                {
                    style: 'display:flex; justify-content:space-between; padding:10px; background:#111; border-bottom:2px solid #ff79c6;',
                },
                [
                    m('h1', { style: 'margin:0; font-size:18px; color:#ff79c6;' }, '47都道府県耐久'),
                    m('.controls', [
                        m(
                            'span',
                            { style: 'font-size:12px; margin-right:10px; color:#aaa;' },
                            `ID: ${State.sessionId}`
                        ),
                        m(
                            'button',
                            {
                                onclick: () => (State.isAccepting = !State.isAccepting),
                                style: `border:none; border-radius:4px; padding:4px 10px; cursor:pointer; background:${State.isAccepting ? '#ff79c6' : '#444'}; color:white;`,
                            },
                            State.isAccepting ? '自動取得ON' : '停止中'
                        ),
                    ]),
                ]
            ),
            m(
                '.status-banner',
                { style: 'text-align:center; padding:5px; background:rgba(255,121,198,0.1); font-weight:bold;' },
                State.statusMessage
            ),
            m(MapView),
            State.currentQuiz
                ? m(
                      '.quiz-overlay',
                      m('.quiz-card', [
                          m('h3', { style: 'color:#ff79c6; margin-top:0;' }, 'AI救済クイズ！'),
                          m('p', State.currentQuiz.question),
                          m(
                              '.opts',
                              State.currentQuiz.options.map((o, i) =>
                                  m(
                                      'button',
                                      {
                                          style: 'display:block; width:100%; margin-bottom:12px; padding:12px; background:#44475a; color:white; border:none; border-radius:8px; cursor:pointer;',
                                          onclick: () => {
                                              if (i === State.currentQuiz.answerIndex)
                                                  State.statusMessage = '回避成功！';
                                              State.currentQuiz = null;
                                              m.redraw();
                                          },
                                      },
                                      o
                                  )
                              )
                          ),
                      ])
                  )
                : null,
            State.isOutEffect
                ? m('.out-overlay', [
                      m('.out-box', [m('h1.out-name', State.displayOutName), m('h1.out-text', 'OUT !!')]),
                  ])
                : null,
        ]),
};

m.mount(document.getElementById('app'), {
    oninit: () => State.init(),
    view: () => (State.sessionId && State.socket ? m(MainView) : m(SetupView)),
});
