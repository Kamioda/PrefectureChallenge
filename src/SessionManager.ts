import { WebSocket } from 'ws';

/**
 * 各エリア（地方）の状態定義
 */
export interface RegionState {
    id: string;
    name: string;
    prefs: string[]; // まだ達成されていない都道府県リスト
    allPrefs: string[]; // リセット用の全都道府県リスト
    isCleared: boolean;
    dovon: string; // このエリアのドボン都道府県名
}

/**
 * セッション全体の型定義
 */
export interface Session {
    regions: RegionState[];
    participants: Set<string>; // 重複チェック用（Set）
    globalParticipantIds: string[]; // フロント・互換用（Array）
    clients: Set<WebSocket>; // 接続中のクライアント
    processedCommentIds: Set<string>; // サーバー側でのコメント重複排除用
    lastEmptyTimestamp: number | null; // 無人になった時刻（GC用）
}

class SessionManager {
    // セッションIDをキーにしたMap管理
    private sessions: Map<string, Session> = new Map();

    /**
     * 新規セッションIDの発行
     */
    createSession(): string {
        // 短いランダムなIDを生成（例: 8文字）
        const sessionId = Math.random().toString(36).substring(2, 10);
        return sessionId;
    }

    /**
     * セッションの取得、または初期化
     * @param sessionId セッションID
     * @param areasData areas.jsonから読み込んだ初期データ
     */
    initSession(sessionId: string, areasData: any): Session {
        let session = this.sessions.get(sessionId);

        if (!session) {
            console.log(`[SessionManager] Initializing new session: ${sessionId}`);

            // areas.json の構造を RegionState 型に変換して初期化
            const regions: RegionState[] = areasData.regions.map((r: any) => ({
                id: r.id,
                name: r.name,
                prefs: [...r.prefs],
                allPrefs: [...r.prefs],
                isCleared: false,
                // エリア内の都道府県からランダムに1つドボンを決定
                dovon: r.prefs[Math.floor(Math.random() * r.prefs.length)],
            }));

            session = {
                regions,
                participants: new Set(),
                globalParticipantIds: [],
                clients: new Set(),
                processedCommentIds: new Set(),
                lastEmptyTimestamp: null,
            };
            this.sessions.set(sessionId, session);
        }
        return session;
    }

    /**
     * 全セッションの取得（ガベージコレクション用）
     */
    getAllSessions(): Map<string, Session> {
        return this.sessions;
    }

    /**
     * セッションの物理削除
     */
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
            region.prefs = [...region.allPrefs]; // 都道府県リストを復元
            region.isCleared = false;
            // ドボンを再配置（任意）
            region.dovon = region.allPrefs[Math.floor(Math.random() * region.allPrefs.length)];
            console.log(`[SessionManager] Region ${regionId} reset in session ${sessionId}`);
        }
    }

    /**
     * セッションに接続中の全クライアントへメッセージを送信
     */
    broadcast(sessionId: string, data: any): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        const payload = JSON.stringify(data);
        session.clients.forEach(client => {
            // 接続が生きている（OPEN）場合のみ送信
            if (client.readyState === 1) {
                client.send(payload);
            }
        });
    }

    /**
     * 永続化保存（現在はプレースホルダ）
     */
    async save(sessionId: string): Promise<void> {
        // 必要に応じてファイルやDBへの書き出し処理を追加
        return Promise.resolve();
    }
}

// シングルトンとしてエクスポート
export const sessionManager = new SessionManager();
