import { WebSocket } from 'ws';

export interface Area {
    id: string;
    name: string;
    prefs: string[]; // まだ埋まっていない都道府県リスト
    dovon: string; // このエリアのドボン県（1つ）
    isCleared: boolean;
}

export interface SessionData {
    sessionId: string;
    regions: Area[];
    globalParticipantIds: string[]; // 全国単位の参加済みユーザーID
    clients: Set<WebSocket>; // 接続中のクライアント（非永続）
    lastEmptyTimestamp: number | null;
}

export interface QuizData {
    question: string;
    options: string[];
    answerIndex: number;
    explanation: string;
}
