const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.db');

let db;
let saveDbCallback = null;

function getDb() { return db; }

function setDb(externalDb) {
    db = externalDb;
    console.log('✅ WebSocket: БД подключена');
}

function setSaveDb(callback) {
    saveDbCallback = callback;
    console.log('✅ WebSocket: функция сохранения БД подключена');
}

function saveDb() {
    if (saveDbCallback) {
        saveDbCallback();
    } else if (db) {
        try {
            const data = db.export();
            fs.writeFileSync(DB_PATH, Buffer.from(data));
        } catch (err) {
            console.error('❌ Ошибка сохранения БД:', err);
        }
    }
}

function getAuth(token) {
    if (!db) return null;
    try {
        const stmt = db.prepare('SELECT * FROM sessions WHERE token = ?');
        stmt.bind([token]);
        if (!stmt.step()) { stmt.free(); return null; }
        const session = stmt.getAsObject();
        stmt.free();
        
        const stmt2 = db.prepare('SELECT * FROM users WHERE id = ?');
        stmt2.bind([session.userId]);
        if (!stmt2.step()) { stmt2.free(); return null; }
        const user = stmt2.getAsObject();
        stmt2.free();
        return user;
    } catch (err) {
        console.error('❌ Auth error:', err);
        return null;
    }
}

const clients = new Map();
const messageRateLimits = new Map();
const RATE_WINDOW = 2000;
const MAX_MESSAGES = 5;

function broadcastOnlineStatus(userId, online) {
    const payload = JSON.stringify({
        type: 'online_status',
        payload: { userId: String(userId), online }
    });
    
    for (const [id, client] of clients) {
        if (client.readyState === WebSocket.OPEN && id !== String(userId)) {
            try {
                client.send(payload);
            } catch (err) {
                console.error('❌ Ошибка отправки статуса:', err);
            }
        }
    }
}

function createWebSocketServer(server) {
    const wss = new WebSocket.Server({ 
        server,
        path: '/ws'
    });
    
    // Heartbeat
    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                console.log('💀 Удаление мёртвого соединения');
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping(() => {});
        });
    }, 30000);
    
    wss.on('close', () => {
        clearInterval(heartbeatInterval);
    });
    
    wss.on('connection', (ws, req) => {
        console.log('🔌 Новое WebSocket подключение');
        
        ws.isAlive = true;
        let userId = null;
        let authenticated = false;
        
        ws.on('pong', () => {
            ws.isAlive = true;
        });
        
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                
                // Авторизация
                if (data.type === 'auth') {
                    const { token } = data.payload || {};
                    
                    if (!token || !db) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            payload: 'Токен не передан или БД не готова' 
                        }));
                        return;
                    }
                    
                    const user = getAuth(token);
                    if (!user) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            payload: 'Неверный токен' 
                        }));
                        ws.close(4001);
                        return;
                    }
                    
                    // Отключаем старое соединение если есть
                    const existing = clients.get(String(user.id));
                    if (existing && existing !== ws) {
                        console.log('⚠️ Закрываем старое соединение пользователя');
                        existing.close(4000, 'Новое подключение');
                    }
                    
                    userId = String(user.id);
                    authenticated = true;
                    clients.set(userId, ws);
                    
                    console.log(`✅ ${user.username} подключён (всего: ${clients.size})`);
                    
                    // Обновляем lastSeen
                    try {
                        db.run('UPDATE users SET lastSeen = ? WHERE id = ?', 
                            [new Date().toISOString(), userId]);
                        saveDb();
                    } catch (err) {}
                    
                    ws.send(JSON.stringify({ 
                        type: 'auth_success', 
                        payload: { userId, username: user.username } 
                    }));
                    
                    broadcastOnlineStatus(userId, true);
                    return;
                }
                
                // Все остальные сообщения требуют авторизации
                if (!authenticated) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        payload: 'Не авторизован' 
                    }));
                    return;
                }
                
                // Rate limiting
                const now = Date.now();
                const userRates = messageRateLimits.get(userId) || [];
                const recentMessages = userRates.filter(t => now - t < RATE_WINDOW);
                
                if (recentMessages.length >= MAX_MESSAGES) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        payload: 'Слишком много сообщений' 
                    }));
                    return;
                }
                
                recentMessages.push(now);
                messageRateLimits.set(userId, recentMessages);
                
                // Отправка сообщения
                if (data.type === 'message') {
                    const { to, text, replyTo, replyToText } = data.payload || {};
                    
                    if (!to || !text || !text.trim()) {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Нет текста' }));
                        return;
                    }
                    if (String(to) === userId) {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Нельзя себе' }));
                        return;
                    }
                    
                    const msgId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
                    const sanitizedText = text.trim().replace(/<[^>]*>/g, '').substring(0, 2000);
                    const sanitizedReply = replyToText ? replyToText.replace(/<[^>]*>/g, '').substring(0, 100) : null;
                    
                    const storedText = JSON.stringify({ 
                        text: sanitizedText, 
                        imageUrl: null, 
                        audioUrl: null,
                        duration: null,
                        replyTo: replyTo || null, 
                        replyToText: sanitizedReply 
                    });
                    
                    // Сохраняем в БД
                    db.run(
                        'INSERT INTO messages (id, fromUserId, toUserId, text, time, read) VALUES (?, ?, ?, ?, ?, 0)', 
                        [msgId, userId, String(to), storedText, new Date().toISOString()]
                    );
                    saveDb();
                    
                    const msgPayload = {
                        type: 'new_message',
                        payload: {
                            id: msgId,
                            from: userId,
                            to: String(to),
                            text: sanitizedText,
                            replyTo: replyTo || null,
                            replyToText: sanitizedReply,
                            time: new Date().toISOString(),
                            read: 0
                        }
                    };
                    
                    // Отправляем получателю
                    const targetWs = clients.get(String(to));
                    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                        targetWs.send(JSON.stringify(msgPayload));
                    }
                    
                    // Подтверждение отправителю
                    ws.send(JSON.stringify({
                        type: 'message_sent',
                        payload: { id: msgId, time: msgPayload.payload.time }
                    }));
                    
                    return;
                }
                
                // Typing индикатор
                if (data.type === 'typing') {
                    const { to, isTyping } = data.payload || {};
                    
                    if (!to || String(to) === userId) return;
                    
                    // Отправляем ТОЛЬКО конкретному получателю
                    const targetWs = clients.get(String(to));
                    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                        targetWs.send(JSON.stringify({
                            type: 'typing',
                            payload: { 
                                from: userId, 
                                isTyping: !!isTyping 
                            }
                        }));
                    }
                    return;
                }
                
                // Ping-pong
                if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', payload: { time: Date.now() } }));
                    return;
                }
                
            } catch (err) {
                console.error('❌ Ошибка обработки:', err);
                try {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        payload: 'Ошибка сервера' 
                    }));
                } catch (sendErr) {}
            }
        });
        
        ws.on('close', () => {
            console.log(`❌ Пользователь ${userId || 'неизвестный'} отключился`);
            if (userId) {
                clients.delete(userId);
                broadcastOnlineStatus(userId, false);
                
                try {
                    db.run('UPDATE users SET lastSeen = ? WHERE id = ?', 
                        [new Date().toISOString(), userId]);
                    saveDb();
                } catch (err) {}
            }
        });
        
        ws.on('error', (err) => {
            console.error('❌ WebSocket ошибка:', err.message);
        });
    });
    
    // Очистка rate limit
    setInterval(() => {
        const now = Date.now();
        for (const [uid, times] of messageRateLimits) {
            const filtered = times.filter(t => now - t < RATE_WINDOW);
            if (filtered.length === 0) {
                messageRateLimits.delete(uid);
            } else {
                messageRateLimits.set(uid, filtered);
            }
        }
    }, 300000);
    
    console.log('✅ WebSocket сервер запущен');
    return { wss, clients, broadcastOnlineStatus };
}

module.exports = { 
    createWebSocketServer, 
    clients, 
    broadcastOnlineStatus, 
    getDb,
    setDb,
    setSaveDb
};
