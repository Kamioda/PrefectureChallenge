import { WebSocket } from 'ws';

/**
 * 各エリア（地方）の状態定義
 */
export interface RegionState {
    id: string;
    name: string;
    prefs: string[];
    allPrefs: string[];
    isCleared: boolean;
    dovon: string;
}

/**
 * セッション全体の型定義
 */
export interface Session {
    // ★追加：配信者の情報
    streamerName: string;
    streamerReading: string;

    regions: RegionState[];
    participants: Set<string>;
    globalParticipantIds: string[];
    clients: Set<WebSocket>;
    processedCommentIds: Set<string>;
    lastEmptyTimestamp: number | null;

    // ★追加：コンボ管理（クイズ権付与用）
    comboCount: number;
}

class SessionManager {
    private sessions: Map<string, Session> = new Map();

    createSession(): string {
        const sessionId = Math.random().toString(36).substring(2, 10);
        return sessionId;
    }

    /**
     * セッションの取得、または初期化
     */
    initSession(sessionId: string, areasData: any): Session {
        let session = this.sessions.get(sessionId);

        if (!session) {
            console.log(`[SessionManager] Initializing new session: ${sessionId}`);

            const regions: RegionState[] = areasData.regions.map((r: any) => ({
                id: r.id,
                name: r.name,
                prefs: [...r.prefs],
                allPrefs: [...r.prefs],
                isCleared: false,
                dovon: r.prefs[Math.floor(Math.random() * r.prefs.length)],
            }));

            session = {
                // ★初期値は空。CLIENT_START メッセージで上書きされる
                streamerName: '',
                streamerReading: '',

                regions,
                participants: new Set(),
                globalParticipantIds: [],
                clients: new Set(),
                processedCommentIds: new Set(),
                lastEmptyTimestamp: null,

                // ★コンボ初期化
                comboCount: 0,
            };
            this.sessions.set(sessionId, session);
        }
        return session;
    }

    getAllSessions(): Map<string, Session> {
        return this.sessions;
    }

    deleteSession(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    /**
     * 特定のエリアをリセット（ドボン発生時）
     */
    resetRegion(sessionId: string, regionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        const region = session.regions.find(r => r.id === regionId);
        if (region) {
            region.prefs = [...region.allPrefs];
            region.isCleared = false;
            // ドボンを再配置
            region.dovon = region.allPrefs[Math.floor(Math.random() * region.allPrefs.length)];

            // ★ドボン時はセッション全体のコンボもリセット
            session.comboCount = 0;

            console.log(`[SessionManager] Region ${regionId} reset in session ${sessionId}`);
        }
    }

    /**
     * 全クライアントへメッセージ送信
     */
    broadcast(sessionId: string, data: any): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        const payload = JSON.stringify(data);
        session.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(payload);
            }
        });
    }

    async save(sessionId: string): Promise<void> {
        // 将来的なDB保存用
        return Promise.resolve();
    }
}

export const sessionManager = new SessionManager();
