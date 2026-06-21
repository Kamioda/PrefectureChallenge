const SERVER_PATH = 'service.meigetsu.jp/prefecture_challenge';

const createUser = () => ({
    id: Date.now() + Math.random(),
    name: '',
    familyName: '',
    firstName: '',
});

const State = {
    users: [createUser()],
    sessions: [],
    created: false,
    isCreating: false,
    errorMessage: '',

    addRow() {
        this.users.push(createUser());
    },

    removeRow(id) {
        this.users = this.users.filter(user => user.id !== id);
    },

    async createSession() {
        if (this.isCreating) return;

        this.isCreating = true;
        this.errorMessage = '';

        try {
            const response = await fetch(`https://${SERVER_PATH}/api/session/new`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const { sessionId } = await response.json();
            if (!sessionId) throw new Error('Session ID was not returned');

            this.sessions = this.users.map(user => {
                const queries = new URLSearchParams({
                    session: sessionId,
                    name: user.name,
                    reading: `${user.familyName} ${user.firstName}`,
                    interval: '1000',
                });

                return {
                    id: user.id,
                    name: user.name,
                    url: `https://${SERVER_PATH}/app.html?${queries.toString()}`,
                };
            });
            this.created = true;
        } catch (error) {
            console.error('Session creation failed', error);
            this.errorMessage = 'セッションの作成に失敗しました。時間をおいて再度お試しください。';
        } finally {
            this.isCreating = false;
            m.redraw();
        }
    },

    async copyUrl(url) {
        try {
            await navigator.clipboard.writeText(url);
            alert('URLをコピーしました');
        } catch (error) {
            console.error('URL copy failed', error);
            alert('URLをコピーできませんでした');
        }
    },
};

const UserForm = {
    view: ({ attrs: { user, index } }) =>
        m('fieldset.border.rounded.p-4.mb-4.bg-white', { key: user.id }, [
            m('.fw-bold.fs-5.mb-3', `${index + 1}人目`),
            m('.mb-3', [
                m('label.form-label', { for: `name-${user.id}` }, '氏名（漢字）'),
                m('input.form-control', {
                    id: `name-${user.id}`,
                    type: 'text',
                    placeholder: '山田 太郎',
                    value: user.name,
                    oninput: event => (user.name = event.target.value),
                }),
            ]),
            m('.mb-3', [
                m('label.form-label', { for: `family-name-${user.id}` }, '名字（読み）'),
                m('input.form-control', {
                    id: `family-name-${user.id}`,
                    type: 'text',
                    placeholder: 'やまだ',
                    value: user.familyName,
                    oninput: event => (user.familyName = event.target.value),
                }),
            ]),
            m('.mb-3', [
                m('label.form-label', { for: `first-name-${user.id}` }, '名前（読み）'),
                m('input.form-control', {
                    id: `first-name-${user.id}`,
                    type: 'text',
                    placeholder: 'たろう',
                    value: user.firstName,
                    oninput: event => (user.firstName = event.target.value),
                }),
            ]),
            State.users.length > 1
                ? m(
                      'button.btn.btn-danger',
                      { type: 'button', onclick: () => State.removeRow(user.id) },
                      '削除'
                  )
                : null,
        ]),
};

const CreationView = {
    view: () => [
        m('h1.mb-4', 'マルチユーザーセッション作成'),
        State.users.map((user, index) => m(UserForm, { key: user.id, user, index })),
        State.errorMessage ? m('.alert.alert-danger', { role: 'alert' }, State.errorMessage) : null,
        m('.d-flex.gap-2', [
            m('button.btn.btn-secondary', { type: 'button', onclick: () => State.addRow() }, '＋ ユーザー追加'),
            m(
                'button.btn.btn-primary',
                {
                    type: 'button',
                    disabled: State.isCreating,
                    onclick: () => State.createSession(),
                },
                State.isCreating ? '作成中...' : '作成'
            ),
        ]),
    ],
};

const SessionsView = {
    view: () => [
        m('h1.mb-4', '生成されたURL'),
        State.sessions.map(session =>
            m('.mb-4', { key: session.id }, [
                m('label.form-label', { for: `session-${session.id}` }, `${session.name} さんのURL`),
                m('input.form-control', {
                    id: `session-${session.id}`,
                    type: 'text',
                    readonly: true,
                    value: session.url,
                    onclick: event => event.target.select(),
                }),
                m(
                    'button.btn.btn-secondary.mt-2',
                    { type: 'button', onclick: () => State.copyUrl(session.url) },
                    'URLをコピー'
                ),
            ])
        ),
        m('p.mb-4', '初めての方は、わんコメのAPI設定で許可ホストに「service.meigetsu.jp」を追加してください。'),
    ],
};

const App = {
    view: () => m('.container.py-4.text-dark', State.created ? m(SessionsView) : m(CreationView)),
};

m.mount(document.getElementById('app'), App);
