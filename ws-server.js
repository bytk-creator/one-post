const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.db');

let db;

function getDb() {
    return db;
}

// Функция для работы с БД (копия из server.js)
function queryOne(sql, params = []) {
    if (!db) return null;
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
    stmt.free();
    return null;
}

function queryAll(sql, params = []) {
    if (!db) return [];
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

// Инициализация БД
async function initDb() {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }
    // Создаём таблицы если их нет
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
        bio TEXT DEFAULT '', avatarUrl TEXT, coverUrl TEXT DEFAULT '', createdAt TEXT NOT NULL,
        lastSeen TEXT DEFAULT '')`);
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, content TEXT NOT NULL,
        imageUrl TEXT, date TEXT NOT NULL, time TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS likes (
        userId TEXT NOT NULL, postId TEXT NOT NULL, time TEXT NOT NULL,
        PRIMARY KEY (userId, postId))`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, fromUserId TEXT NOT NULL, toUserId TEXT NOT NULL,
        text TEXT NOT NULL, time TEXT NOT NULL, read INTEGER DEFAULT 0)`);
    return db;
}

// Проверка токена
function getAuth(token) {
    if (!db) return null;
    const stmt = db.prepare('SELECT * FROM sessions WHERE token = ?');
    stmt.bind([token]);
    if (!stmt.step()) return null;
    const session = stmt.getAsObject();
    stmt.free();
    const stmt2 = db.prepare('SELECT * FROM users WHERE id = ?');
    stmt2.bind([session.userId]);
    if (!stmt2.step()) return null;
    const user = stmt2.getAsObject();
    stmt2.free();
    return user;
}

// Создаём HTTP сервер для WebSocket
const server = require('http').createServer();
const wss = new WebSocket.Server({ server });

// Хранилище подключений
const clients = new Map();

// Обработка подключений
wss.on('connection', (ws, req) => {
    console.log('🔌 Новое WebSocket подключение');
    
    let userId = null;
    
    // Получаем токен из URL
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    
    if (!token) {
        ws.close(4001, 'Токен не передан');
        return;
    }
    
    // Ждём авторизацию
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'auth') {
                const { userId: uid, token: t } = data;
                
                // Проверяем токен через БД
                if (!db) await initDb();
                const user = getAuth(t);
                
                if (!user) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        payload: 'Неверный токен' 
                    }));
                    ws.close(4003, 'Неверный токен');
                    return;
                }
                
                userId = String(user.id);
                
                // Сохраняем подключение
                clients.set(userId, ws);
                console.log(`✅ Пользователь ${userId} (${user.username}) подключён`);
                
                // Подтверждаем авторизацию
                ws.send(JSON.stringify({ 
                    type: 'auth_success', 
                    payload: { userId, username: user.username } 
                }));
                
                // Уведомляем всех об онлайн-статусе
                broadcastOnlineStatus(userId, true);
                return;
            }
            
            // Обработка сообщений
            if (data.type === 'message' && userId) {
                const { to, text, replyTo, replyToText } = data.payload;
                
                if (String(to) === String(userId)) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        payload: 'Нельзя себе' 
                    }));
                    return;
                }
                
                // Проверяем получателя
                if (!db) await initDb();
                const targetUser = queryOne('SELECT id FROM users WHERE id = ?', [String(to)]);
                if (!targetUser) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        payload: 'Пользователь не найден' 
                    }));
                    return;
                }
                
                const msgId = Date.now().toString();
                const sanitizedText = (text || '').replace(/<[^>]*>/g, '').substring(0, 2000);
                const storedText = JSON.stringify({ 
                    text: sanitizedText, 
                    imageUrl: null, 
                    replyTo: replyTo || null, 
                    replyToText: replyToText || null 
                });
                
                // Сохраняем в БД
                if (db) {
                    db.run('INSERT INTO messages (id, fromUserId, toUserId, text, time, read) VALUES (?, ?, ?, ?, ?, 0)', 
                        [msgId, userId, String(to), storedText, new Date().toISOString()]);
                    // Сохраняем БД
                    const data = db.export();
                    fs.writeFileSync(DB_PATH, Buffer.from(data));
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
                    fromUsername: 'User' // Заполним позже
                };
                
                // Отправляем получателю, если онлайн
                const targetWs = clients.get(String(to));
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({
                        type: 'new_message',
                        payload: msgData
                    }));
                }
                
                // Подтверждение отправителю
                ws.send(JSON.stringify({
                    type: 'message_sent',
                    payload: { id: msgId, time: msgData.time }
                }));
            }
            
            // Обработка статуса печатания
            if (data.type === 'typing' && userId) {
                const { to, isTyping } = data.payload;
                const targetWs = clients.get(String(to));
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({
                        type: 'typing',
                        payload: { from: String(userId), isTyping }
                    }));
                }
            }
            
            // Ping/Pong
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', payload: { time: Date.now() } }));
            }
            
        } catch (err) {
            console.error('❌ WebSocket ошибка:', err);
            ws.send(JSON.stringify({ 
                type: 'error', 
                payload: 'Ошибка обработки' 
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
        if (userId) {
            clients.delete(userId);
            broadcastOnlineStatus(userId, false);
        }
    });
});

// Рассылка онлайн-статуса
function broadcastOnlineStatus(userId, online) {
    const payload = JSON.stringify({
        type: 'online_status',
        payload: { userId: String(userId), online }
    });
    
    for (const [_, client] of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

// Инициализация БД при старте
initDb().then(() => {
    console.log('✅ WebSocket: БД инициализирована');
}).catch(err => {
    console.error('❌ WebSocket: Ошибка инициализации БД:', err);
});

// Сохраняем для интеграции
module.exports = { wss, clients, broadcastOnlineStatus, getDb };

// Запуск на порту 8080
const PORT = process.env.WS_PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🟢 WebSocket сервер запущен на порту ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Закрываем WebSocket сервер...');
    wss.close(() => {
        server.close(() => {
            console.log('✅ WebSocket сервер остановлен');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Закрываем WebSocket сервер...');
    wss.close(() => {
        server.close(() => {
            console.log('✅ WebSocket сервер остановлен');
            process.exit(0);
        });
    });
});
