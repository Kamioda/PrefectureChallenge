import express from 'express';
import expressWs from 'express-ws';
import { sessionManager } from './SessionManager.js';
import { generateQuiz } from './Gemini.js';
import fs from 'fs';

const { app } = expressWs(express());
const port = process.env.PORT || 3000;

const DEBUG_MODE = process.argv.includes('--debug');
// パスを確認してください（./data/areas.json）
const AREAS_DATA = JSON.parse(fs.readFileSync('./data/areas.json', 'utf8'));

setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    for (const [id, session] of sessionManager.getAllSessions()) {
        if (session.clients.size === 0 && session.lastEmptyTimestamp) {
            if (now - session.lastEmptyTimestamp > oneHour) {
                console.log(`[GC] Session expired: ${id}`);
                sessionManager.deleteSession(id);
            }
        }
    }
}, 60000);

app.use(express.json());

app.get('/api/session/new', (req, res) => {
    const sessionId = sessionManager.createSession();
    res.json({ sessionId });
});

app.ws('/ws/:sessionId', (ws, req) => {
    const sessionId = req.params.sessionId as string;
    // セッション取得（なければ作成、データ注入）
    const session = sessionManager.initSession(sessionId, AREAS_DATA);

    session.clients.add(ws as any);
    session.lastEmptyTimestamp = null;

    // --- 【重要】接続の瞬間に現在の地図状態をクライアントに送る ---
    ws.send(
        JSON.stringify({
            type: 'INIT',
            regions: session.regions,
        })
    );

    ws.on('message', async (msg: string) => {
        try {
            const data = JSON.parse(msg);

            // デバッグログ
            if (DEBUG_MODE && data.type === 'RAW_COMMENTS') {
                console.log(`[WS Inbound] Received ${data.comments?.length} comments`);
            }

            switch (data.type) {
                case 'RAW_COMMENTS': {
                    const { comments } = data;
                    if (!comments) break;

                    comments.forEach((c: any) => {
                        const cId = c.id;
                        const text = c.comment;
                        const uId = c.userId;

                        if (session.processedCommentIds.has(cId)) return;
                        session.processedCommentIds.add(cId);

                        AREAS_DATA.regions.forEach((r: any) => {
                            r.prefs.forEach((pref: string) => {
                                const short = pref.replace(/[都道府県]$/, '');
                                if (text.includes(short)) {
                                    handleLogic(session, sessionId, uId, pref);
                                }
                            });
                        });
                    });
                    break;
                }
                case 'SELECT_PREF': {
                    handleLogic(session, sessionId, data.userId, data.prefName);
                    break;
                }
                case 'REQUEST_QUIZ': {
                    const quiz = await generateQuiz(data.prefName);
                    sessionManager.broadcast(sessionId, { type: 'QUIZ_DATA', quiz });
                    break;
                }
            }
        } catch (e) {
            console.error('Message Error:', e);
        }
    });

    ws.on('close', () => {
        session.clients.delete(ws as any);
        if (session.clients.size === 0) session.lastEmptyTimestamp = Date.now();
    });
});

function handleLogic(session: any, sId: string, uId: string, pref: string) {
    // ここで session.regions が空だと find が失敗して return されます
    const region = session.regions.find((r: any) => r.prefs.includes(pref));

    if (!region) {
        if (DEBUG_MODE) console.log(`[Skip] ${pref} is not in remaining prefs.`);
        return;
    }
    if (region.isCleared) return;

    if (!DEBUG_MODE && session.globalParticipantIds.includes(uId)) return;

    // 【注意】スペルが 'dovon' になっています。areas.json側も 'dovon' ですか？
    if (pref === region.dovon) {
        console.log(`DOBON! ${pref}`);
        sessionManager.resetRegion(sId, region.id);
        sessionManager.broadcast(sId, {
            type: 'DOBON_RESET',
            prefName: pref,
            regions: session.regions,
        });
    } else {
        region.prefs = region.prefs.filter((p: string) => p !== pref);
        session.globalParticipantIds.push(uId);

        if (region.prefs.length === 1 && region.prefs[0] === region.dovon) {
            region.isCleared = true;
        }

        sessionManager.broadcast(sId, {
            type: 'SUCCESS',
            prefName: pref,
            areaId: region.id,
            isCleared: region.isCleared,
        });
    }
}

app.use(express.static('./wwwroot'));
app.listen(port, () => console.log(`Server started. Mode: ${DEBUG_MODE ? 'DEBUG' : 'PROD'}`));
