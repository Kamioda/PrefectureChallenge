import express from 'express';
import expressWs from 'express-ws';
import { sessionManager } from './SessionManager.js';
import { generateQuiz } from './Gemini.js';
import fs from 'fs';

const { app } = expressWs(express());
const port = process.env.PORT || 3000;

const DEBUG_MODE = process.argv.includes('--debug');
const AREAS_DATA = JSON.parse(fs.readFileSync('./data/areas.json', 'utf8'));

// GC（ガベージコレクション）
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
    const session = sessionManager.initSession(sessionId, AREAS_DATA);

    session.clients.add(ws as any);
    session.lastEmptyTimestamp = null;

    ws.on('message', async (msg: string) => {
        try {
            const data = JSON.parse(msg);

            switch (data.type) {
                case 'CLIENT_START':
                    // 名前と「スペース入りよみがな」を保存
                    session.streamerName = data.name;
                    session.streamerReading = data.reading;

                    ws.send(
                        JSON.stringify({
                            type: 'INIT',
                            regions: session.regions,
                        })
                    );
                    break;

                case 'RAW_COMMENTS':
                    if (!session.streamerName) break;
                    data.comments.forEach((c: any) => {
                        if (session.processedCommentIds.has(c.id)) return;
                        session.processedCommentIds.add(c.id);

                        for (const region of session.regions) {
                            if (region.isCleared) continue;
                            for (const pref of region.prefs) {
                                const short = pref.replace(/[都道府県]$/, '');
                                if (c.comment.includes(short)) {
                                    handleLogic(session, sessionId, c.userId, pref);
                                    return;
                                }
                            }
                        }
                    });
                    break;

                case 'SELECT_PREF':
                    handleLogic(session, sessionId, data.userId, data.prefName);
                    break;

                case 'REQUEST_QUIZ':
                    const quiz = await generateQuiz(data.prefName);
                    sessionManager.broadcast(sessionId, { type: 'QUIZ_DATA', quiz });
                    break;
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
    const region = session.regions.find((r: any) => r.prefs.includes(pref));
    if (!region || region.isCleared) return;

    if (!DEBUG_MODE && session.globalParticipantIds.includes(uId)) return;

    if (pref === region.dovon) {
        console.log(`[DOBON] ${session.streamerName} hit ${pref}!`);
        sessionManager.resetRegion(sId, region.id);
        sessionManager.broadcast(sId, {
            type: 'DOBON_RESET',
            prefName: pref,
            regions: session.regions,
            streamerName: session.streamerName,
        });
    } else {
        region.prefs = region.prefs.filter((p: string) => p !== pref);
        session.globalParticipantIds.push(uId);
        session.comboCount++;

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
app.listen(port, () => console.log(`Server started on port ${port}`));
