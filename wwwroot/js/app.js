/**
 * 47都道府県耐久配信システム v1.5 [Final Edition]
 * - エリア別カラー (mapData.json 参照)
 * - 絶望のルーレット演出 (batsu.txt 参照)
 * - クイズ連動・音響演出 (鐘の音/ドラムロール/各種SE)
 * - 罰ゲーム常駐テロップ機能
 */

const DEFAULT_COLOR = '#ff79c6';

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

    // --- 音響設定 ---
    se: {
        dedeen: new Audio('assets/sounds/dedeen.mp3'),
        drumroll: new Audio('assets/sounds/drumroll.mp3'),
        finish: new Audio('assets/sounds/finish.mp3'),
        correct: new Audio('assets/sounds/correct.mp3'),
        incorrect: new Audio('assets/sounds/incorrect.mp3'),
        avoid: new Audio('assets/sounds/avoid_success.mp3'),
        funeralBell: new Audio('assets/sounds/funeral_bell.mp3'), // 絶望の鐘
    },

    // --- 演出・UI状態 ---
    activeEffect: null, // 'correct', 'incorrect', 'avoid_success', 'roulette_time'
    isOutEffect: false, // ドボン(デデーン)中
    isBatsuChoiceVisible: false,
    isRouletteVisible: false,
    isBatsuFinalized: false,
    activeBatsu: '', // 現在執行中の罰ゲーム内容（テロップ用）

    batsuList: [],
    selectedBatsu: '',
    outTimer: null,
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
            // mapData.json
            this.mapData = await m.request({ url: 'data/mapData.json' });
            // batsu.txt
            const rawBatsu = await m.request({
                url: 'data/batsu.txt',
                deserialize: v => v,
            });
            this.batsuList = rawBatsu.split(/\r?\n/).filter(line => line.trim() !== '');
        } catch (e) {
            console.error('Data Load Error', e);
            this.batsuList = ['激辛チップス', '全力モノマネ'];
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

        let finalMs = directInterval || this.params.get('interval') || 1000;
        window.history.pushState(
            {},
            '',
            `?session=${this.sessionId}&name=${encodeURIComponent(this.streamerName)}&reading=${encodeURIComponent(this.streamerReading)}&interval=${finalMs}`
        );

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

    // --- 演出コアロジック ---

    async triggerEffect(type, duration, seName) {
        this.activeEffect = type;
        if (seName && this.se[seName]) {
            this.se[seName].currentTime = 0;
            this.se[seName].play();
        }
        m.redraw();
        await new Promise(r => setTimeout(r, duration));
        this.activeEffect = null;
        m.redraw();
    },

    async handleQuizAnswer(index) {
        if (!this.currentQuiz) return;
        const isCorrect = index === this.currentQuiz.answerIndex;
        this.currentQuiz = null;

        if (isCorrect) {
            await this.triggerEffect('correct', 800, 'correct');
            await this.triggerEffect('avoid_success', 2000, 'avoid');
            this.statusMessage = '★回避成功！';
        } else {
            await this.triggerEffect('incorrect', 1000, 'incorrect');
            // 絶望の「間」
            await new Promise(r => setTimeout(r, 1000));
            // 鐘の音とともにルーレットタイム表示
            await this.triggerEffect('roulette_time', 2500, 'funeralBell');
            this.startRoulette();
        }
    },

    async startRoulette() {
        this.isBatsuChoiceVisible = false;
        this.isRouletteVisible = true;
        this.isBatsuFinalized = false;
        this.selectedBatsu = '抽選中...';
        m.redraw();

        this.se.drumroll.currentTime = 0;
        this.se.drumroll.loop = true;
        this.se.drumroll.play();

        for (let i = 0; i < 25; i++) {
            this.selectedBatsu = this.batsuList[Math.floor(Math.random() * this.batsuList.length)];
            m.redraw();
            await new Promise(r => setTimeout(r, 50 + i * i * 0.5));
        }

        this.se.drumroll.pause();
        this.selectedBatsu = '？？？';
        m.redraw();
        await new Promise(r => setTimeout(r, 1000));

        this.se.finish.currentTime = 0;
        this.se.finish.play();

        const finalBatsu = this.batsuList[Math.floor(Math.random() * this.batsuList.length)];
        this.selectedBatsu = finalBatsu;
        this.activeBatsu = finalBatsu; // 常駐テロップにセット
        this.isBatsuFinalized = true;
        m.redraw();
    },

    stopAllEffects() {
        if (this.outTimer) clearTimeout(this.outTimer);
        Object.values(this.se).forEach(s => {
            s.pause();
            s.currentTime = 0;
        });
        if (this.currentVoice) this.currentVoice.pause();
        this.isOutEffect = false;
        this.activeEffect = null;
        this.isBatsuChoiceVisible = false;
        this.isRouletteVisible = false;
        m.redraw();
    },

    async playOutSequence() {
        this.stopAllEffects();
        this.isOutEffect = true;
        this.displayOutName = this.streamerName;
        m.redraw();
        this.se.dedeen.play();
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
            this.isBatsuChoiceVisible = true;
            m.redraw();
        }, 5000);
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
                    this.socket.send(
                        JSON.stringify({
                            type: 'RAW_COMMENTS',
                            comments: res.map(r => ({ id: r.data.id, comment: r.data.comment, userId: r.data.userId })),
                        })
                    );
                }
            } catch (e) {}
        }, interval);
    },

    localUpdate(areaId, prefName, isCleared) {
        const r = this.regions.find(reg => reg.id === areaId);
        if (r) {
            r.prefs = r.prefs.filter(p => p !== prefName);
            r.isCleared = isCleared;
            // 県をクリアしたら罰ゲームテロップを消す
            this.activeBatsu = '';
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
                            const isFilled = sr && !sr.prefs.includes(p.id);
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
                m(
                    'button',
                    { onclick: () => (State.isAccepting = !State.isAccepting) },
                    State.isAccepting ? '自動取得ON' : '停止中'
                ),
            ]),
            m(MapView),

            // --- 罰ゲーム常駐テロップ ---
            State.activeBatsu
                ? m('.batsu-ticker', [m('span.label', '罰ゲーム執行中'), m('span.content', State.activeBatsu)])
                : null,

            // --- 各種オーバーレイ ---
            // 1. アウト演出
            State.isOutEffect
                ? m('.out-overlay', { onclick: () => State.stopAllEffects() }, [
                      m('.out-box', [m('h1.out-name', State.displayOutName), m('h1.out-text', 'OUT !!')]),
                  ])
                : null,

            // 2. 選択
            State.isBatsuChoiceVisible
                ? m(
                      '.quiz-overlay',
                      m('.quiz-card', [
                          m('h2', '運命の選択'),
                          m(
                              'button.start-btn',
                              {
                                  style: 'background:#ffb86c; margin-bottom:10px;',
                                  onclick: () => State.startRoulette(),
                              },
                              'ルーレットで決定'
                          ),
                          m(
                              'button.start-btn',
                              {
                                  style: 'background:#50fa7b;',
                                  onclick: () => {
                                      State.isBatsuChoiceVisible = false;
                                      State.socket.send(JSON.stringify({ type: 'REQUEST_QUIZ', prefName: '日本' }));
                                  },
                              },
                              'クイズで回避挑戦'
                          ),
                      ])
                  )
                : null,

            // 3. ルーレット
            State.isRouletteVisible
                ? m(
                      '.quiz-overlay',
                      m('.quiz-card', [
                          m('h2', '罰ゲーム抽選'),
                          m(
                              'div',
                              {
                                  class: State.isBatsuFinalized ? 'batsu-final-text' : '',
                                  style: 'min-height:100px; font-size:32px; color:white; display:flex; align-items:center; justify-content:center;',
                              },
                              State.selectedBatsu
                          ),
                          State.isBatsuFinalized
                              ? m('button.start-btn', { onclick: () => (State.isRouletteVisible = false) }, '閉じる')
                              : null,
                      ])
                  )
                : null,

            // 4. クイズ
            State.currentQuiz
                ? m(
                      '.quiz-overlay',
                      m('.quiz-card', [
                          m('h3', 'AI救済クイズ'),
                          m('p', State.currentQuiz.question),
                          State.currentQuiz.options.map((o, i) =>
                              m(
                                  'button.start-btn',
                                  {
                                      style: 'margin-bottom:8px; background:#44475a;',
                                      onclick: () => State.handleQuizAnswer(i),
                                  },
                                  o
                              )
                          ),
                      ])
                  )
                : null,

            // 5. 共通アニメーション演出 (赤丸・青バツ・回避成功・ルーレットタイム)
            State.activeEffect
                ? m('.full-screen-overlay', [
                      State.activeEffect === 'correct' ? m('.double-circle') : null,
                      State.activeEffect === 'incorrect' ? m('.cross') : null,
                      State.activeEffect === 'avoid_success' ? m('h1.effect-text.avoid', '回避成功！') : null,
                      State.activeEffect === 'roulette_time' ? m('h1.effect-text.roulette', 'ルーレットタイム') : null,
                  ])
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
