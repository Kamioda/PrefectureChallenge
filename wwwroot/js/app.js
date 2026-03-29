/**
 * 47都道府県耐久システム - フロントエンド (デザイン復元 ＋ サーバー主導版)
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

    inputSessionId: '',
    inputInterval: 1,
    inputUnit: 'sec',

    async init() {
        this.sessionId = this.params.get('session');
        this.oneCommeHost = this.params.get('onecomme') || '127.0.0.1';
        try {
            this.mapData = await m.request({ method: 'GET', url: 'data/mapData.json' });
        } catch (e) {
            console.error('Map Load Error', e);
        }
        if (this.sessionId) {
            const pInterval = this.params.get('interval') || 1000;
            this.startSystem(parseInt(pInterval));
        }
    },

    async startSystem(directInterval = null) {
        if (!this.sessionId) {
            if (this.inputSessionId.trim() !== '') {
                this.sessionId = this.inputSessionId.trim();
            } else {
                try {
                    const res = await m.request({ method: 'GET', url: '/api/session/new' });
                    this.sessionId = res.sessionId;
                } catch (e) {
                    this.statusMessage = 'エラー: セッションの発行に失敗しました';
                    m.redraw();
                    return;
                }
            }
        }
        let finalMs = directInterval || (this.inputUnit === 'sec' ? this.inputInterval * 1000 : this.inputInterval);
        window.history.pushState({}, '', `?session=${this.sessionId}&interval=${finalMs}`);
        this.connectMain();
        this.startOneCommePolling(finalMs);
        this.statusMessage = 'システム稼働中';
        m.redraw();
    },

    connectMain() {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        this.socket = new WebSocket(`${protocol}://${window.location.host}/ws/${this.sessionId}`);
        this.socket.onmessage = event => {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'INIT':
                case 'UPDATE_MAP':
                case 'DOBON_RESET':
                    this.regions = data.regions;
                    if (data.type === 'DOBON_RESET') this.statusMessage = `【ドボン】${data.prefName}でリセット！`;
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

    /**
     * 【修正】判定ロジックを全削除し、RAW_COMMENTSとしてサーバーへ丸投げ
     */
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
                    // サーバー側で重複排除と都道府県判定をさせる
                    this.socket.send(
                        JSON.stringify({
                            type: 'RAW_COMMENTS',
                            comments: res.map(r => ({ id: r.data.id, comment: r.data.comment, userId: r.data.userId })),
                        })
                    );
                }
            } catch (e) {
                console.warn('OneComme API Offline');
            }
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
                // 沖縄回避用境界線
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
                m('h2', '耐久配信システム設定'),
                m('.form-group', [
                    m('label', 'セッションID (継続時)'),
                    m('input.text-input[type=text]', {
                        value: State.inputSessionId,
                        oninput: e => (State.inputSessionId = e.target.value),
                    }),
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
                m('button.start-btn', { onclick: () => State.startSystem() }, '開始'),
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
                      {
                          style: 'position:fixed; inset:0; background:rgba(0,0,0,0.8); display:flex; align-items:center; justify-content:center; z-index:2000;',
                      },
                      m(
                          '.quiz-card',
                          {
                              style: 'background:#282a36; padding:30px; border-radius:15px; border:3px solid #ff79c6; text-align:center; width:400px;',
                          },
                          [
                              m('h3', { style: 'color:#ff79c6; margin-top:0;' }, 'AI救済クイズ！'),
                              m('p', State.currentQuiz.question),
                              m(
                                  '.opts',
                                  State.currentQuiz.options.map((o, i) =>
                                      m(
                                          'button',
                                          {
                                              style: 'display:block; width:100%; margin-bottom:12px; padding:12px; background:#44475a; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold;',
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
                          ]
                      )
                  )
                : null,
        ]),
};

m.mount(document.getElementById('app'), {
    oninit: () => State.init(),
    view: () => (State.sessionId && State.socket ? m(MainView) : m(SetupView)),
});
