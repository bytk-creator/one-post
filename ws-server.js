const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.db');

let db;

function getDb() { return db; }

async function initDb() {
    try {
        const SQL = await initSqlJs();
        if (fs.existsSync(DB_PATH)) {
            const buffer = fs.readFileSync(DB_PATH);
            db = new SQL.Database(buffer);
        } else {
            db = new SQL.Database();
        }
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
            bio TEXT DEFAULT '', avatarUrl TEXT, coverUrl TEXT DEFAULT '', createdAt TEXT NOT NULL,
            lastSeen TEXT DEFAULT '')`);
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt TEXT NOT NULL)`);
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY, fromUserId TEXT NOT NULL, toUserId TEXT NOT NULL,
            text TEXT NOT NULL, time TEXT NOT NULL, read INTEGER DEFAULT 0)`);
        console.log('✅ WebSocket: БД инициализирована');
        return true;
    } catch (err) {
        console.error('❌ WebSocket: Ошибка инициализации БД:', err);
        return false;
    }
}

function getAuth(token) {
    if (!db) {
        console.log('⚠️ БД не инициализирована');
        return null;
    }
    try {
        const stmt = db.prepare('SELECT * FROM sessions WHERE token = ?');
        stmt.bind([token]);
        if (!stmt.step()) {
            stmt.free();
            console.log('❌ Токен не найден в сессиях');
            return null;
        }
        const session = stmt.getAsObject();
        stmt.free();
        
        const stmt2 = db.prepare('SELECT * FROM users WHERE id = ?');
        stmt2.bind([session.userId]);
        if (!stmt2.step()) {
            stmt2.free();
            console.log('❌ Пользователь не найден');
            return null;
        }
        const user = stmt2.getAsObject();
        stmt2.free();
        
        console.log('✅ Пользователь найден:', user.username);
        return user;
    } catch (err) {
        console.error('❌ Auth error:', err);
        return null;
    }
}

function setDb(externalDb) {
    db = externalDb;
    console.log('✅ WebSocket: Используем внешнюю БД');
}

const clients = new Map();

function broadcastOnlineStatus(userId, online) {
    const payload = JSON.stringify({
        type: 'online_status',
        payload: { userId: String(userId), online }
    });
    
    for (const [_, client] of clients) {
        if (client.readyState === WebSocket.OPEN) {
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
    
    wss.on('connection', (ws, req) => {
        console.log('🔌 Новое WebSocket подключение');
        
        let userId = null;
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        
        console.log('📝 Получен токен:', token ? token.substring(0, 20) + '...' : 'НЕТ ТОКЕНА');
        
        if (!token) {
            console.log('❌ Нет токена');
            ws.send(JSON.stringify({ 
                type: 'error', 
                payload: 'Токен не передан' 
            }));
            ws.close(4001);
            return;
        }
        
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                console.log('📨 Получено WS сообщение:', data.type);
                
                if (data.type === 'auth') {
                    console.log('🔐 Авторизация...');
                    const { userId: uid, token: t } = data.payload || {};
                    
                    if (!t) {
                        console.log('❌ Нет токена');
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            payload: 'Токен не передан' 
                        }));
                        return;
                    }
                    
                    if (!db) {
                        console.log('⏳ Инициализация БД...');
                        await initDb();
                    }
                    
                    const user = getAuth(t);
                    
                    if (!user) {
                        console.log('❌ Неверный токен');
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            payload: 'Неверный токен' 
                        }));
                        return;
                    }
                    
                    userId = String(user.id);
                    clients.set(userId, ws);
                    console.log(`✅ Пользователь ${userId} (${user.username}) подключён`);
                    
                    ws.send(JSON.stringify({ 
                        type: 'auth_success', 
                        payload: { userId, username: user.username } 
                    }));
                    
                    broadcastOnlineStatus(userId, true);
                    return;
                }
                
                if (data.type === 'message' && userId) {
                    console.log('📨 Сообщение от', userId);
                    const { to, text, replyTo, replyToText } = data.payload || {};
                    
                    if (!to) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            payload: 'Нет получателя' 
                        }));
                        return;
                    }
                    
                    if (String(to) === String(userId)) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            payload: 'Нельзя себе' 
                        }));
                        return;
                    }
                    
                    if (!db) await initDb();
                    
                    const msgId = Date.now().toString();
                    const sanitizedText = (text || '').replace(/<[^>]*>/g, '').substring(0, 2000);
                    const storedText = JSON.stringify({ 
                        text: sanitizedText, 
                        imageUrl: null, 
                        replyTo: replyTo || null, 
                        replyToText: replyToText || null 
                    });
                    
                    try {
                        db.run('INSERT INTO messages (id, fromUserId, toUserId, text, time, read) VALUES (?, ?, ?, ?, ?, 0)', 
                            [msgId, userId, String(to), storedText, new Date().toISOString()]);
                        const data = db.export();
                        fs.writeFileSync(DB_PATH, Buffer.from(data));
                        console.log('✅ Сообщение сохранено в БД');
                    } catch (err) {
                        console.error('❌ Ошибка сохранения:', err);
                    }
                    
                    const msgData = {
                        id: msgId,
                        from: String(userId),
                        to: String(to),
                        text: sanitizedText,
                        replyTo: replyTo || null,
                        replyToText: replyToText || null,
                        time: new Date().toISOString(),
                        read: 0,
                        fromUsername: 'User'
                    };
                    
                    const targetWs = clients.get(String(to));
                    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                        targetWs.send(JSON.stringify({
                            type: 'new_message',
                            payload: msgData
                        }));
                        console.log('📤 Сообщение отправлено получателю');
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'message_sent',
                        payload: { id: msgId, time: msgData.time }
                    }));
                    return;
                }
                
                if (data.type === 'typing' && userId) {
                    console.log('⌨️ Typing от', userId);
                    const { to, isTyping } = data.payload || {};
                    if (!to) return;
                    
                    const targetWs = clients.get(String(to));
                    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                        targetWs.send(JSON.stringify({
                            type: 'typing',
                            payload: { from: String(userId), isTyping: !!isTyping }
                        }));
                        console.log('📤 Typing отправлен');
                    }
                    return;
                }
                
                if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', payload: { time: Date.now() } }));
                    return;
                }
                
                console.log('⚠️ Неизвестный тип:', data.type);
                
            } catch (err) {
                console.error('❌ Ошибка обработки:', err);
                ws.send(JSON.stringify({ 
                    type: 'error', 
                    payload: 'Ошибка обработки: ' + err.message 
                }));
            }
        });
        
        ws.on('close', () => {
            console.log(`❌ Пользователь ${userId || 'неизвестный'} отключился`);
            if (userId) {
                clients.delete(userId);
                broadcastOnlineStatus(userId, false);
            }
        });
        
        ws.on('error', (err) => {
            console.error('❌ WebSocket ошибка:', err);
        });
    });
    
    return { wss, clients, broadcastOnlineStatus };
}

module.exports = { 
    createWebSocketServer, 
    clients, 
    broadcastOnlineStatus, 
    getDb,
    setDb,
    initDb
};
