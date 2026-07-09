const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const formidable = require('formidable');
const initSqlJs = require('sql.js');
const { createWebSocketServer, clients, broadcastOnlineStatus, setDb, setSaveDb } = require('./ws-server');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const AUDIO_DIR = path.join(UPLOADS_DIR, 'audio');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'database.db');

let db;

function saveDb() {
    if (!db) return;
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDb() {
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
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, content TEXT NOT NULL,
        imageUrl TEXT, date TEXT NOT NULL, time TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS likes (
        userId TEXT NOT NULL, postId TEXT NOT NULL, time TEXT NOT NULL,
        PRIMARY KEY (userId, postId))`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, fromUserId TEXT NOT NULL, toUserId TEXT NOT NULL,
        text TEXT NOT NULL, time TEXT NOT NULL, read INTEGER DEFAULT 0)`);
    
    db.run(`CREATE INDEX IF NOT EXISTS idx_posts_userId ON posts(userId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_posts_time ON posts(time DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_from_to ON messages(fromUserId, toUserId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(time DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_likes_postId ON likes(postId)`);
    
    setDb(db);
    setSaveDb(saveDb);
    console.log('✅ БД передана в WebSocket сервер');
    
    saveDb();
}

// Rate limiting
const rateLimits = new Map();
function checkRateLimit(key, maxRequests, windowMs) {
    const now = Date.now();
    const requests = rateLimits.get(key) || [];
    const recent = requests.filter(t => now - t < windowMs);
    
    if (recent.length >= maxRequests) return false;
    
    recent.push(now);
    rateLimits.set(key, recent);
    return true;
}

// Очистка старых rate limit записей
setInterval(() => {
    const now = Date.now();
    for (const [key, times] of rateLimits) {
        const filtered = times.filter(t => now - t < 60000);
        if (filtered.length === 0) {
            rateLimits.delete(key);
        } else {
            rateLimits.set(key, filtered);
        }
    }
}, 60000);

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'one-post-salt').digest('hex');
}

function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { resolve({}); }
        });
    });
}

function parseFormData(req) {
    return new Promise((resolve) => {
        const form = new formidable.IncomingForm({
            uploadDir: UPLOADS_DIR,
            keepExtensions: true,
            maxFileSize: 25 * 1024 * 1024,
            allowEmptyFiles: false,
            multiples: true
        });
        
        form.parse(req, (err, fields, files) => {
            if (err) {
                console.error('❌ formidable error:', err);
                resolve({ error: err.message, fields: {}, files: {} });
                return;
            }
            
            const cleanFields = {};
            Object.keys(fields).forEach(key => {
                cleanFields[key] = Array.isArray(fields[key]) ? fields[key][0] : fields[key];
            });
            
            const cleanFiles = {};
            Object.keys(files).forEach(key => {
                if (Array.isArray(files[key])) {
                    cleanFiles[key] = files[key];
                } else if (files[key]) {
                    cleanFiles[key] = [files[key]];
                }
            });
            
            resolve({ fields: cleanFields, files: cleanFiles });
        });
    });
}

function getAuth(req) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return null;
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
}

function serveFile(res, filePath, contentType) {
    const fullPath = path.join(__dirname, filePath);
    fs.readFile(fullPath, 'utf8', (err, data) => {
        if (err) { res.writeHead(500); res.end('Error'); return; }
        res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
        res.end(data, 'utf8');
    });
}

function serveBinaryFile(res, filePath) {
    const fullPath = path.join(__dirname, filePath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.webm': 'audio/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg'
    };
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.readFile(fullPath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

function serveJSON(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data), 'utf8');
}

function queryOne(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
    stmt.free();
    return null;
}

function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

function runSql(sql, params = []) {
    db.run(sql, params);
    saveDb();
}

function sanitizeText(text, maxLength = 1000) {
    if (!text) return '';
    return text
        .trim()
        .replace(/<[^>]*>/g, '')
        .replace(/javascript:/gi, '')
        .substring(0, maxLength);
}

function parseLastMsg(text) {
    if (!text) return '';
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            if (parsed.audioUrl) return '🎤 Голосовое';
            if (parsed.imageUrl) return '📷 Фото';
            if (parsed.text) return parsed.text;
        }
        return text;
    } catch (e) { return text; }
}

function parseMsgText(text) {
    if (!text) return { text: '', imageUrl: null, audioUrl: null, duration: null, replyTo: null, replyToText: null };
    
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            return {
                text: parsed.text ? sanitizeText(parsed.text, 2000) : '',
                imageUrl: parsed.imageUrl || null,
                audioUrl: parsed.audioUrl || null,
                duration: parsed.duration || null,
                replyTo: parsed.replyTo || null,
                replyToText: parsed.replyToText ? sanitizeText(parsed.replyToText, 100) : null
            };
        }
        return { text: sanitizeText(text, 2000), imageUrl: null, audioUrl: null, duration: null, replyTo: null, replyToText: null };
    } catch (e) {
        return { text: sanitizeText(text, 2000), imageUrl: null, audioUrl: null, duration: null, replyTo: null, replyToText: null };
    }
}

function isOnline(lastSeen) {
    if (!lastSeen) return false;
    return (new Date() - new Date(lastSeen)) < 60000;
}

// Отправка сообщения через WebSocket
function sendMessageViaWS(fromUserId, toUserId, message) {
    const targetWs = clients.get(String(toUserId));
    if (targetWs && targetWs.readyState === 1) {
        try {
            targetWs.send(JSON.stringify(message));
            return true;
        } catch (err) {
            console.error('❌ Ошибка отправки WS:', err);
            return false;
        }
    }
    return false;
}

const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const method = req.method;
    const currentUser = getAuth(req);

    // Статика и uploads
    if (url.startsWith('/uploads/') && method === 'GET') {
        return serveBinaryFile(res, 'public' + url);
    }

    if (url === '/api/register' && method === 'POST') {
        if (!checkRateLimit('register_' + req.socket.remoteAddress, 5, 60000)) {
            return serveJSON(res, { error: 'Слишком много попыток. Попробуйте через минуту.' }, 429);
        }
        
        const { username, password } = await readBody(req);
        if (!username || !password) return serveJSON(res, { error: 'Логин и пароль обязательны' }, 400);
        if (username.length < 3) return serveJSON(res, { error: 'Логин минимум 3 символа' }, 400);
        if (!/^[a-zA-Z0-9_]+$/.test(username)) return serveJSON(res, { error: 'OneID: только английские буквы, цифры и _' }, 400);
        if (password.length < 4) return serveJSON(res, { error: 'Пароль минимум 4 символа' }, 400);
        if (queryOne('SELECT id FROM users WHERE username = ?', [username])) return serveJSON(res, { error: 'Пользователь уже существует' }, 400);
        
        const userId = Date.now().toString();
        runSql('INSERT INTO users (id, username, password, bio, avatarUrl, coverUrl, createdAt, lastSeen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
            [userId, username, hashPassword(password), '', null, '', new Date().toISOString(), new Date().toISOString()]);
        
        const token = crypto.randomBytes(32).toString('hex');
        runSql('INSERT OR REPLACE INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)', 
            [token, userId, new Date().toISOString()]);
        
        return serveJSON(res, { success: true, token, user: { id: userId, username } });
    }

    if (url === '/api/login' && method === 'POST') {
        if (!checkRateLimit('login_' + req.socket.remoteAddress, 5, 60000)) {
            return serveJSON(res, { error: 'Слишком много попыток. Попробуйте через минуту.' }, 429);
        }
        
        const { username, password } = await readBody(req);
        const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || user.password !== hashPassword(password)) return serveJSON(res, { error: 'Неверный логин или пароль' }, 401);
        
        const token = crypto.randomBytes(32).toString('hex');
        runSql('INSERT OR REPLACE INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)', 
            [token, user.id, new Date().toISOString()]);
        runSql('UPDATE users SET lastSeen = ? WHERE id = ?', [new Date().toISOString(), user.id]);
        
        return serveJSON(res, { success: true, token, user: { id: user.id, username: user.username } });
    }

    // ... [остальные API роуты остаются без изменений, они уже работают корректно]
    // Я пропускаю их для краткости, но они должны остаться как были

    if (url === '/api/post' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Войдите в аккаунт' }, 401);
        if (!checkRateLimit('post_' + currentUser.id, 1, 60000)) {
            return serveJSON(res, { error: 'Подождите минуту перед следующей публикацией' }, 429);
        }
        
        // ... остальная логика поста
    }

    // Аудио-сообщения — ИСПРАВЛЕНО
    if (url === '/api/messages/audio' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        if (!checkRateLimit('msg_' + currentUser.id, 5, 2000)) {
            return serveJSON(res, { error: 'Слишком быстро. Подождите.' }, 429);
        }
        
        const result = await parseFormData(req);
        if (result.error) {
            return serveJSON(res, { error: 'Ошибка загрузки: ' + result.error }, 400);
        }
        
        const { fields, files } = result;
        const to = fields.to;
        const duration = parseInt(fields.duration) || 0;
        
        if (!to) return serveJSON(res, { error: 'Получатель обязателен' }, 400);
        
        const targetUser = queryOne('SELECT id FROM users WHERE id = ?', [String(to)]);
        if (!targetUser) return serveJSON(res, { error: 'Пользователь не найден' }, 404);
        if (String(to) === String(currentUser.id)) return serveJSON(res, { error: 'Нельзя себе' }, 400);
        
        // Поиск файла во всех возможных полях
        let fileData = null;
        const possibleFields = ['audio', 'file', 'voice', 'recording', 'blob'];
        
        for (const field of possibleFields) {
            if (files[field] && Array.isArray(files[field]) && files[field][0]) {
                fileData = files[field][0];
                break;
            }
        }
        
        if (!fileData) {
            // Проверяем другие поля FormData
            for (const key in files) {
                if (Array.isArray(files[key]) && files[key][0] && files[key][0].mimetype) {
                    fileData = files[key][0];
                    break;
                }
            }
        }
        
        if (!fileData) {
            return serveJSON(res, { error: 'Аудио файл не найден' }, 400);
        }
        
        const allowedTypes = ['audio/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'video/webm'];
        if (!allowedTypes.includes(fileData.mimetype || '')) {
            return serveJSON(res, { error: 'Неподдерживаемый формат' }, 400);
        }
        
        const ext = path.extname(fileData.originalFilename || '.webm') || '.webm';
        const fileName = 'audio-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
        const audioPath = path.join(AUDIO_DIR, fileName);
        
        try {
            if (fs.existsSync(fileData.filepath)) {
                fs.renameSync(fileData.filepath, audioPath);
            } else {
                return serveJSON(res, { error: 'Файл не найден' }, 400);
            }
        } catch (err) {
            console.error('❌ Ошибка сохранения аудио:', err);
            return serveJSON(res, { error: 'Ошибка сохранения' }, 500);
        }
        
        const audioUrl = '/uploads/audio/' + fileName;
        const msgId = Date.now().toString() + '-' + crypto.randomBytes(4).toString('hex');
        const storedText = JSON.stringify({
            text: '🎤 Голосовое сообщение',
            audioUrl: audioUrl,
            duration: duration,
            imageUrl: null,
            replyTo: null,
            replyToText: null
        });
        
        runSql('INSERT INTO messages (id, fromUserId, toUserId, text, time, read) VALUES (?, ?, ?, ?, ?, 0)',
            [msgId, currentUser.id, String(to), storedText, new Date().toISOString()]);
        
        // Отправляем через WebSocket
        const msgData = {
            type: 'new_message',
            payload: {
                id: msgId,
                from: String(currentUser.id),
                to: String(to),
                text: '🎤 Голосовое сообщение',
                audioUrl: audioUrl,
                duration: duration,
                imageUrl: null,
                replyTo: null,
                replyToText: null,
                time: new Date().toISOString(),
                read: 0,
                fromUsername: currentUser.username
            }
        };
        
        sendMessageViaWS(currentUser.id, to, msgData);
        
        return serveJSON(res, {
            success: true,
            message: {
                id: msgId,
                audioUrl: audioUrl,
                duration: duration
            }
        });
    }

    // Статика и SPA — без изменений
    if (url === '/css/style.css') return serveFile(res, 'public/css/style.css', 'text/css');
    if (url === '/js/app.js') return serveFile(res, 'public/js/app.js', 'application/javascript');
    if (url === '/manifest.json') return serveFile(res, 'public/manifest.json', 'application/json');
    if (url === '/service-worker.js') return serveFile(res, 'public/service-worker.js', 'application/javascript');
    if (url.match(/^\/icon-\d+\.svg$/)) return serveFile(res, 'public' + url, 'image/svg+xml');

    if (method === 'GET' && !url.startsWith('/api/') && !url.startsWith('/uploads/')) {
        return serveFile(res, 'public/index.html', 'text/html');
    }

    res.writeHead(404);
    res.end('Not found');
});

initDb().then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log('🚀 Сервер запущен на порту ' + PORT);
        createWebSocketServer(server);
        console.log('✅ WebSocket сервер интегрирован');
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Сохраняем БД...');
    saveDb();
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    console.log('🛑 Сохраняем БД...');
    saveDb();
    server.close(() => process.exit(0));
});
