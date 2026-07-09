const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const formidable = require('formidable');
const initSqlJs = require('sql.js');
const { createWebSocketServer, clients, broadcastOnlineStatus, setDb } = require('./ws-server');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const AUDIO_DIR = path.join(UPLOADS_DIR, 'audio');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'database.db');

let db;

function saveDb() {
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
    
    try {
        setDb(db);
        console.log('✅ БД передана в WebSocket сервер');
    } catch (err) {
        console.log('ℹ️ WebSocket не загружен');
    }
    
    saveDb();
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
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
            
            resolve({ fields: cleanFields, files });
        });
    });
}

function getAuth(req) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return null;
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

// ===== WEBSOCKET ИНТЕГРАЦИЯ =====
let wsClients = clients || new Map();

function sendMessageViaWS(to, message) {
    const targetWs = wsClients.get(String(to));
    if (targetWs && targetWs.readyState === 1) {
        try {
            targetWs.send(JSON.stringify(message));
            return true;
        } catch (err) {
            return false;
        }
    }
    return false;
}

// Генерация иконок
(function generateIcons() {
    [192, 512].forEach(size => {
        const p = path.join(__dirname, 'public', `icon-${size}.svg`);
        if (!fs.existsSync(p)) {
            fs.writeFileSync(p, `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
                <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7B8CFF"/><stop offset="100%" stop-color="#4F6EF7"/></linearGradient></defs>
                <rect width="${size}" height="${size}" rx="${size/4}" fill="url(#g)"/>
                <rect x="${size*0.22}" y="${size*0.28}" width="${size*0.56}" height="${size*0.44}" rx="${size*0.06}" fill="white" opacity="0.95"/>
                <line x1="${size*0.3}" y1="${size*0.42}" x2="${size*0.7}" y2="${size*0.42}" stroke="#4F6EF7" stroke-width="${size*0.04}" stroke-linecap="round"/>
                <line x1="${size*0.3}" y1="${size*0.53}" x2="${size*0.58}" y2="${size*0.53}" stroke="#7B8CFF" stroke-width="${size*0.03}" stroke-linecap="round"/>
                <line x1="${size*0.3}" y1="${size*0.63}" x2="${size*0.48}" y2="${size*0.63}" stroke="#A5B4FC" stroke-width="${size*0.02}" stroke-linecap="round"/>
            </svg>`);
        }
    });
})();

const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const method = req.method;
    const currentUser = getAuth(req);

    if (url.startsWith('/uploads/') && method === 'GET') {
        return serveBinaryFile(res, 'public' + url);
    }

    if (url === '/api/register' && method === 'POST') {
        const { username, password } = await readBody(req);
        if (!username || !password) return serveJSON(res, { error: 'Логин и пароль обязательны' }, 400);
        if (username.length < 3) return serveJSON(res, { error: 'Логин минимум 3 символа' }, 400);
        if (!/^[a-zA-Z0-9_]+$/.test(username)) return serveJSON(res, { error: 'OneID: только английские буквы, цифры и _' }, 400);
        if (password.length < 4) return serveJSON(res, { error: 'Пароль минимум 4 символа' }, 400);
        if (queryOne('SELECT id FROM users WHERE username = ?', [username])) return serveJSON(res, { error: 'Пользователь уже существует' }, 400);
        const userId = Date.now().toString();
        runSql('INSERT INTO users (id, username, password, bio, avatarUrl, coverUrl, createdAt, lastSeen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [userId, username, hashPassword(password), '', null, '', new Date().toISOString(), new Date().toISOString()]);
        const token = crypto.randomBytes(32).toString('hex');
        runSql('INSERT OR REPLACE INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)', [token, userId, new Date().toISOString()]);
        return serveJSON(res, { success: true, token, user: { id: userId, username } });
    }

    if (url === '/api/login' && method === 'POST') {
        const { username, password } = await readBody(req);
        const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || user.password !== hashPassword(password)) return serveJSON(res, { error: 'Неверный логин или пароль' }, 401);
        const token = crypto.randomBytes(32).toString('hex');
        runSql('INSERT OR REPLACE INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)', [token, user.id, new Date().toISOString()]);
        runSql('UPDATE users SET lastSeen = ? WHERE id = ?', [new Date().toISOString(), user.id]);
        return serveJSON(res, { success: true, token, user: { id: user.id, username: user.username } });
    }

    if (url === '/api/me' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const today = new Date().toISOString().split('T')[0];
        const count = queryOne('SELECT COUNT(*) as count FROM posts WHERE userId = ? AND date = ?', [currentUser.id, today]);
        return serveJSON(res, { user: { id: currentUser.id, username: currentUser.username, bio: currentUser.bio || '', avatarUrl: currentUser.avatarUrl, coverUrl: currentUser.coverUrl || '', createdAt: currentUser.createdAt }, canPost: count.count === 0 });
    }

    if (url === '/api/ping' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        runSql('UPDATE users SET lastSeen = ? WHERE id = ?', [new Date().toISOString(), currentUser.id]);
        return serveJSON(res, { success: true });
    }

    if (url.match(/^\/api\/user\/[^/]+$/) && method === 'GET') {
        const userId = url.split('/')[3];
        const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) return serveJSON(res, { error: 'Пользователь не найден' }, 404);
        const posts = queryAll('SELECT * FROM posts WHERE userId = ? ORDER BY time DESC', [userId]);
        const dates = [...new Set(posts.map(p => p.date))].sort().reverse();
        let streak = 0;
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        if (dates.length > 0 && (dates[0] === today || dates[0] === yesterday)) {
            streak = 1;
            for (let i = 1; i < dates.length; i++) {
                const prev = new Date(dates[i-1]); prev.setDate(prev.getDate() - 1);
                if (dates[i] === prev.toISOString().split('T')[0]) streak++; else break;
            }
        }
        return serveJSON(res, { id: user.id, username: user.username, bio: user.bio || '', avatarUrl: user.avatarUrl, coverUrl: user.coverUrl || '', createdAt: user.createdAt, totalPosts: posts.length, streak, online: isOnline(user.lastSeen), lastSeen: user.lastSeen });
    }

    if (url.match(/^\/api\/user\/[^/]+\/posts$/) && method === 'GET') {
        const userId = url.split('/')[3];
        const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) return serveJSON(res, { error: 'Пользователь не найден' }, 404);
        const posts = queryAll('SELECT * FROM posts WHERE userId = ? ORDER BY time DESC', [userId]).map(p => ({ ...p, author: user.username, authorAvatar: user.avatarUrl }));
        return serveJSON(res, posts);
    }

    if (url === '/api/post' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Войдите в аккаунт' }, 401);
        const today = new Date().toISOString().split('T')[0];
        if (queryOne('SELECT COUNT(*) as count FROM posts WHERE userId = ? AND date = ?', [currentUser.id, today]).count > 0) return serveJSON(res, { error: 'Вы уже публиковали сегодня' }, 400);
        const result = await parseFormData(req);
        if (result.error) return serveJSON(res, { error: 'Ошибка загрузки файла: ' + result.error }, 400);
        
        const { fields, files } = result;
        const content = fields.content || '';
        if (!content.trim()) return serveJSON(res, { error: 'Пост не может быть пустым' }, 400);
        
        const sanitizedContent = sanitizeText(content, 1000);
        if (!sanitizedContent) return serveJSON(res, { error: 'Пост содержит недопустимые символы' }, 400);
        
        let imageUrl = null;
        if (files.image && files.image[0]) {
            const file = files.image[0];
            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (!allowedTypes.includes(file.mimetype)) {
                return serveJSON(res, { error: 'Неподдерживаемый формат изображения' }, 400);
            }
            const ext = path.extname(file.originalFilename || '.jpg');
            const fileName = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
            fs.renameSync(file.filepath, path.join(UPLOADS_DIR, fileName));
            imageUrl = '/uploads/' + fileName;
        }
        const postId = Date.now().toString();
        runSql('INSERT INTO posts (id, userId, content, imageUrl, date, time) VALUES (?, ?, ?, ?, ?, ?)', [postId, currentUser.id, sanitizedContent, imageUrl, today, new Date().toISOString()]);
        return serveJSON(res, { success: true, post: { id: postId, content: sanitizedContent, imageUrl, author: currentUser.username } });
    }

    if (url === '/api/posts' && method === 'GET') {
        const page = parseInt((new URL(req.url, 'http://localhost').searchParams.get('page') || '1'));
        const limit = 20;
        const offset = (page - 1) * limit;
        const posts = queryAll('SELECT posts.*, users.username as author, users.avatarUrl as authorAvatar FROM posts JOIN users ON posts.userId = users.id ORDER BY posts.time DESC LIMIT ? OFFSET ?', [limit, offset]);
        return serveJSON(res, posts);
    }

    if (url.match(/^\/api\/post\/[^/]+$/) && method === 'DELETE') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const postId = url.split('/')[3];
        const post = queryOne('SELECT * FROM posts WHERE id = ?', [postId]);
        if (!post) return serveJSON(res, { error: 'Пост не найден' }, 404);
        if (post.userId !== currentUser.id) return serveJSON(res, { error: 'Это не ваш пост' }, 403);
        if (post.imageUrl) { const imgPath = path.join(__dirname, 'public', post.imageUrl); if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); }
        runSql('DELETE FROM likes WHERE postId = ?', [postId]);
        runSql('DELETE FROM posts WHERE id = ?', [postId]);
        return serveJSON(res, { success: true });
    }

    if (url === '/api/like' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const { postId } = await readBody(req);
        const existing = queryOne('SELECT * FROM likes WHERE userId = ? AND postId = ?', [currentUser.id, postId]);
        if (existing) runSql('DELETE FROM likes WHERE userId = ? AND postId = ?', [currentUser.id, postId]);
        else runSql('INSERT INTO likes (userId, postId, time) VALUES (?, ?, ?)', [currentUser.id, postId, new Date().toISOString()]);
        const count = queryOne('SELECT COUNT(*) as count FROM likes WHERE postId = ?', [postId]).count;
        return serveJSON(res, { liked: !existing, count });
    }

    if (url === '/api/likes' && method === 'POST') {
        const { postIds } = await readBody(req);
        if (!postIds || !Array.isArray(postIds)) return serveJSON(res, {});
        const myLikes = currentUser ? queryAll('SELECT postId FROM likes WHERE userId = ?', [currentUser.id]).map(r => r.postId) : [];
        const result = {};
        postIds.forEach(pid => { result[pid] = { count: queryOne('SELECT COUNT(*) as count FROM likes WHERE postId = ?', [pid]).count, liked: myLikes.includes(pid) }; });
        return serveJSON(res, result);
    }

    if (url === '/api/settings' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        return serveJSON(res, { username: currentUser.username, bio: currentUser.bio || '', avatarUrl: currentUser.avatarUrl, coverUrl: currentUser.coverUrl || '' });
    }

    if (url === '/api/settings' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            const result = await parseFormData(req);
            if (result.error) return serveJSON(res, { error: 'Ошибка загрузки файла: ' + result.error }, 400);
            const { files } = result;
            
            if (files.avatar && files.avatar[0]) {
                const file = files.avatar[0];
                const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                if (!allowedTypes.includes(file.mimetype)) {
                    return serveJSON(res, { error: 'Неподдерживаемый формат изображения' }, 400);
                }
                const ext = path.extname(file.originalFilename || '.jpg');
                const fileName = 'avatar-' + currentUser.id + ext;
                if (currentUser.avatarUrl) { const oldPath = path.join(__dirname, 'public', currentUser.avatarUrl); if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); }
                fs.renameSync(file.filepath, path.join(UPLOADS_DIR, fileName));
                const avatarUrl = '/uploads/' + fileName;
                runSql('UPDATE users SET avatarUrl = ? WHERE id = ?', [avatarUrl, currentUser.id]);
                return serveJSON(res, { success: true, avatarUrl });
            }
            if (files.cover && files.cover[0]) {
                const file = files.cover[0];
                const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                if (!allowedTypes.includes(file.mimetype)) {
                    return serveJSON(res, { error: 'Неподдерживаемый формат изображения' }, 400);
                }
                const ext = path.extname(file.originalFilename || '.jpg');
                const fileName = 'cover-' + currentUser.id + ext;
                if (currentUser.coverUrl) { const oldPath = path.join(__dirname, 'public', currentUser.coverUrl); if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); }
                fs.renameSync(file.filepath, path.join(UPLOADS_DIR, fileName));
                const coverUrl = '/uploads/' + fileName;
                runSql('UPDATE users SET coverUrl = ? WHERE id = ?', [coverUrl, currentUser.id]);
                return serveJSON(res, { success: true, coverUrl });
            }
            return serveJSON(res, { success: true });
        }
        const { username, password, bio } = await readBody(req);
        const newUsername = username !== undefined ? sanitizeText(username, 30) : currentUser.username;
        const newPassword = password && password.trim() ? hashPassword(password.trim()) : currentUser.password;
        const newBio = bio !== undefined ? sanitizeText(bio, 200) : (currentUser.bio || '');
        if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) return serveJSON(res, { error: 'OneID: только английские буквы, цифры и _' }, 400);
        if (newUsername.length < 3) return serveJSON(res, { error: 'Имя минимум 3 символа' }, 400);
        if (password && password.trim() && password.trim().length < 4) return serveJSON(res, { error: 'Пароль минимум 4 символа' }, 400);
        runSql('UPDATE users SET username = ?, password = ?, bio = ? WHERE id = ?', [newUsername, newPassword, newBio, currentUser.id]);
        return serveJSON(res, { success: true, user: { id: currentUser.id, username: newUsername, bio: newBio, avatarUrl: currentUser.avatarUrl } });
    }

    if (url === '/api/dialogs' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const partners = queryAll('SELECT DISTINCT CASE WHEN fromUserId = ? THEN toUserId ELSE fromUserId END as partnerId FROM messages WHERE fromUserId = ? OR toUserId = ?', [currentUser.id, currentUser.id, currentUser.id]);
        const dialogs = [];
        for (const p of partners) {
            const partner = queryOne('SELECT * FROM users WHERE id = ?', [String(p.partnerId)]);
            if (!partner) continue;
            const lastMsg = queryOne('SELECT * FROM messages WHERE (fromUserId = ? AND toUserId = ?) OR (fromUserId = ? AND toUserId = ?) ORDER BY time DESC LIMIT 1', [currentUser.id, partner.id, partner.id, currentUser.id]);
            const unread = queryOne('SELECT COUNT(*) as count FROM messages WHERE toUserId = ? AND fromUserId = ? AND read = 0', [currentUser.id, partner.id]).count;
            dialogs.push({ userId: String(partner.id), username: partner.username, avatarUrl: partner.avatarUrl, lastMessage: lastMsg ? parseLastMsg(lastMsg.text) : '', lastTime: lastMsg ? lastMsg.time : '', unread, online: isOnline(partner.lastSeen) });
        }
        dialogs.sort((a, b) => b.lastTime.localeCompare(a.lastTime));
        return serveJSON(res, dialogs);
    }

    if (url.startsWith('/api/messages/') && url !== '/api/messages/photo' && url !== '/api/messages/audio' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const partnerId = url.split('/')[3];
        const params = new URL(req.url, 'http://localhost').searchParams;
        const before = params.get('before');
        
        const targetUser = queryOne('SELECT id FROM users WHERE id = ?', [String(partnerId)]);
        if (!targetUser) return serveJSON(res, { error: 'Пользователь не найден' }, 404);
        
        runSql('UPDATE messages SET read = 1 WHERE fromUserId = ? AND toUserId = ? AND read = 0', [partnerId, currentUser.id]);
        
        let sql = 'SELECT messages.*, u1.username as fromUsername, u2.username as toUsername FROM messages JOIN users u1 ON messages.fromUserId = u1.id JOIN users u2 ON messages.toUserId = u2.id WHERE ((fromUserId = ? AND toUserId = ?) OR (fromUserId = ? AND toUserId = ?))';
        const sqlParams = [currentUser.id, partnerId, partnerId, currentUser.id];
        
        if (before) {
            sql += ' AND messages.time < ?';
            sqlParams.push(before);
        }
        sql += ' ORDER BY messages.time DESC LIMIT 51';
        
        const results = queryAll(sql, sqlParams);
        const hasMore = results.length > 50;
        const messages = results.slice(0, 50).reverse();
        
        const fixed = messages.map(m => {
            const parsed = parseMsgText(m.text);
            return {
                id: String(m.id),
                from: String(m.fromUserId),
                to: String(m.toUserId),
                fromUserId: String(m.fromUserId),
                toUserId: String(m.toUserId),
                text: parsed.text,
                imageUrl: parsed.imageUrl,
                audioUrl: parsed.audioUrl,
                duration: parsed.duration,
                replyTo: parsed.replyTo,
                replyToText: parsed.replyToText,
                time: m.time,
                read: m.read,
                fromUsername: m.fromUsername,
                toUsername: m.toUsername
            };
        });
        return serveJSON(res, { messages: fixed, hasMore });
    }

    if (url === '/api/unread-messages' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const messages = queryAll(
            'SELECT messages.*, u1.username as fromUsername FROM messages JOIN users u1 ON messages.fromUserId = u1.id WHERE messages.toUserId = ? AND messages.read = 0 ORDER BY messages.time DESC LIMIT 20',
            [currentUser.id]
        );
        const fixed = messages.map(m => {
            const parsed = parseMsgText(m.text);
            return { id: String(m.id), from: String(m.fromUserId), text: parsed.text, fromUsername: m.fromUsername, time: m.time };
        });
        return serveJSON(res, fixed);
    }

    // ===== ОБРАБОТКА АУДИО (ГОЛОСОВЫЕ СООБЩЕНИЯ) =====
    if (url === '/api/messages/audio' && method === 'POST') {
        console.log('🎙 Получен запрос на загрузку аудио');
        
        if (!currentUser) {
            console.log('❌ Не авторизован');
            return serveJSON(res, { error: 'Не авторизован' }, 401);
        }
        
        const result = await parseFormData(req);
        console.log('📦 Результат парсинга:', JSON.stringify(result, null, 2));
        
        if (result.error) {
            console.log('❌ Ошибка парсинга:', result.error);
            return serveJSON(res, { error: 'Ошибка загрузки аудио: ' + result.error }, 400);
        }
        
        const { fields, files } = result;
        console.log('📋 fields:', fields);
        console.log('📎 files:', files);
        
        const to = fields.to;
        const duration = parseInt(fields.duration) || 0;
        
        if (!to) {
            console.log('❌ Нет получателя');
            return serveJSON(res, { error: 'Получатель обязателен' }, 400);
        }
        
        const targetUser = queryOne('SELECT id FROM users WHERE id = ?', [String(to)]);
        if (!targetUser) {
            console.log('❌ Пользователь не найден');
            return serveJSON(res, { error: 'Пользователь не найден' }, 404);
        }
        
        if (String(to) === String(currentUser.id)) {
            console.log('❌ Нельзя себе');
            return serveJSON(res, { error: 'Нельзя себе' }, 400);
        }
        
        let audioUrl = null;
        
        // Проверяем наличие файла
        console.log('🔍 Проверка files.audio:', files.audio);
        
        if (files.audio && files.audio[0]) {
            const file = files.audio[0];
            console.log('📎 Файл получен:', {
                originalFilename: file.originalFilename,
                mimetype: file.mimetype,
                size: file.size,
                filepath: file.filepath
            });
            
            const allowedTypes = ['audio/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'];
            if (!allowedTypes.includes(file.mimetype)) {
                console.log('❌ Неподдерживаемый формат:', file.mimetype);
                return serveJSON(res, { error: 'Неподдерживаемый формат аудио: ' + file.mimetype }, 400);
            }
            
            const ext = path.extname(file.originalFilename || '.webm');
            const fileName = 'audio-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
            const audioPath = path.join(AUDIO_DIR, fileName);
            
            console.log('💾 Сохраняем файл:', audioPath);
            
            try {
                // Проверяем, существует ли исходный файл
                if (fs.existsSync(file.filepath)) {
                    fs.renameSync(file.filepath, audioPath);
                    audioUrl = '/uploads/audio/' + fileName;
                    console.log('✅ Файл сохранён:', audioUrl);
                } else {
                    console.log('❌ Исходный файл не найден:', file.filepath);
                    return serveJSON(res, { error: 'Файл не найден на сервере' }, 400);
                }
            } catch (err) {
                console.error('❌ Ошибка сохранения файла:', err);
                return serveJSON(res, { error: 'Ошибка сохранения файла: ' + err.message }, 500);
            }
        } else {
            console.log('❌ Нет файла в запросе');
            console.log('📎 files:', files);
            // Проверяем другие возможные имена поля
            if (files.file && files.file[0]) {
                console.log('📎 Нашли файл в поле "file":', files.file[0]);
                // Можно обработать и это поле
            }
            return serveJSON(res, { error: 'Аудио файл не найден в запросе' }, 400);
        }
        
        if (!audioUrl) {
            console.log('❌ Аудио не загружено');
            return serveJSON(res, { error: 'Аудио не загружено' }, 400);
        }
        
        // Сохраняем сообщение
        const msgId = Date.now().toString();
        const storedText = JSON.stringify({
            text: '🎤 Голосовое сообщение',
            audioUrl: audioUrl,
            duration: duration,
            imageUrl: null,
            replyTo: null,
            replyToText: null
        });
        
        try {
            runSql('INSERT INTO messages (id, fromUserId, toUserId, text, time, read) VALUES (?, ?, ?, ?, ?, 0)',
                [msgId, currentUser.id, String(to), storedText, new Date().toISOString()]);
            console.log('✅ Сообщение сохранено в БД');
        } catch (err) {
            console.error('❌ Ошибка сохранения сообщения:', err);
            return serveJSON(res, { error: 'Ошибка сохранения сообщения' }, 500);
        }
        
        // Отправляем через WebSocket
        sendMessageViaWS(to, {
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
        });
        
        console.log('✅ Аудио сообщение успешно создано');
        return serveJSON(res, {
            success: true,
            message: {
                id: msgId,
                from: String(currentUser.id),
                to: String(to),
                audioUrl: audioUrl,
                duration: duration,
                fromUsername: currentUser.username
            }
        });
    }

    if (url === '/api/messages/photo' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const result = await parseFormData(req);
        if (result.error) return serveJSON(res, { error: 'Ошибка загрузки файла: ' + result.error }, 400);
        
        const { fields, files } = result;
        const to = fields.to;
        const text = fields.text || '';
        const replyTo = fields.replyTo || null;
        const replyToText = fields.replyToText ? sanitizeText(fields.replyToText, 100) : null;
        
        if (!to) return serveJSON(res, { error: 'Получатель обязателен' }, 400);
        
        const targetUser = queryOne('SELECT id FROM users WHERE id = ?', [String(to)]);
        if (!targetUser) return serveJSON(res, { error: 'Пользователь не найден' }, 404);
        
        if (String(to) === String(currentUser.id)) return serveJSON(res, { error: 'Нельзя себе' }, 400);
        
        let imageUrl = null;
        if (files.image && files.image[0]) {
            const file = files.image[0];
            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (!allowedTypes.includes(file.mimetype)) {
                return serveJSON(res, { error: 'Неподдерживаемый формат изображения' }, 400);
            }
            const ext = path.extname(file.originalFilename || '.jpg');
            const fileName = 'chat-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
            fs.renameSync(file.filepath, path.join(UPLOADS_DIR, fileName));
            imageUrl = '/uploads/' + fileName;
        }
        const msgId = Date.now().toString();
        const sanitizedText = sanitizeText(text, 2000);
        const storedText = JSON.stringify({ text: sanitizedText, imageUrl, replyTo, replyToText });
        runSql('INSERT INTO messages (id, fromUserId, toUserId, text, time, read) VALUES (?, ?, ?, ?, ?, 0)', [msgId, currentUser.id, String(to), storedText, new Date().toISOString()]);
        
        sendMessageViaWS(to, {
            type: 'new_message',
            payload: {
                id: msgId,
                from: String(currentUser.id),
                to: String(to),
                text: sanitizedText || '',
                imageUrl: imageUrl,
                audioUrl: null,
                duration: null,
                replyTo: replyTo || null,
                replyToText: replyToText || null,
                time: new Date().toISOString(),
                read: 0,
                fromUsername: currentUser.username
            }
        });
        
        return serveJSON(res, { success: true, message: { id: msgId, from: String(currentUser.id), to: String(to), text: sanitizedText, imageUrl, replyTo, replyToText, fromUsername: currentUser.username } });
    }

    if (url === '/api/messages' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const { to, text, replyTo, replyToText } = await readBody(req);
        if (!to || !text || !text.trim()) return serveJSON(res, { error: 'Получатель и текст обязательны' }, 400);
        
        const targetUser = queryOne('SELECT id FROM users WHERE id = ?', [String(to)]);
        if (!targetUser) return serveJSON(res, { error: 'Пользователь не найден' }, 404);
        
        if (String(to) === String(currentUser.id)) return serveJSON(res, { error: 'Нельзя себе' }, 400);
        
        const msgId = Date.now().toString();
        const sanitizedText = sanitizeText(text, 2000);
        const sanitizedReplyText = replyToText ? sanitizeText(replyToText, 100) : null;
        const storedText = JSON.stringify({ text: sanitizedText, imageUrl: null, audioUrl: null, duration: null, replyTo: replyTo || null, replyToText: sanitizedReplyText });
        runSql('INSERT INTO messages (id, fromUserId, toUserId, text, time, read) VALUES (?, ?, ?, ?, ?, 0)', [msgId, currentUser.id, String(to), storedText, new Date().toISOString()]);
        
        sendMessageViaWS(to, {
            type: 'new_message',
            payload: {
                id: msgId,
                from: String(currentUser.id),
                to: String(to),
                text: sanitizedText,
                imageUrl: null,
                audioUrl: null,
                duration: null,
                replyTo: replyTo || null,
                replyToText: sanitizedReplyText || null,
                time: new Date().toISOString(),
                read: 0,
                fromUsername: currentUser.username
            }
        });
        
        return serveJSON(res, { success: true, message: { id: msgId, from: String(currentUser.id), to: String(to), text: sanitizedText, replyTo, replyToText: sanitizedReplyText, fromUsername: currentUser.username } });
    }

    if (url.startsWith('/api/users/search') && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const urlObj = new URL(url, 'http://localhost');
        const q = (urlObj.searchParams.get('q') || '').trim().toLowerCase();
        const users = queryAll('SELECT id, username, avatarUrl, lastSeen FROM users WHERE id != ?', [currentUser.id]);
        const filtered = users.filter(u => u.username.toLowerCase().includes(q)).slice(0, 10);
        return serveJSON(res, filtered.map(u => ({ id: String(u.id), username: u.username, avatarUrl: u.avatarUrl, online: isOnline(u.lastSeen) })));
    }

    if (url === '/api/unread' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const count = queryOne('SELECT COUNT(*) as count FROM messages WHERE toUserId = ? AND read = 0', [currentUser.id]).count;
        return serveJSON(res, { count });
    }

    // Статика
    if (url === '/css/style.css') return serveFile(res, 'public/css/style.css', 'text/css');
    if (url === '/js/app.js') return serveFile(res, 'public/js/app.js', 'application/javascript');
    if (url === '/manifest.json') return serveFile(res, 'public/manifest.json', 'application/json');
    if (url === '/service-worker.js') return serveFile(res, 'public/service-worker.js', 'application/javascript');
    if (url.match(/^\/icon-\d+\.svg$/)) return serveFile(res, 'public' + url, 'image/svg+xml');

    // SPA
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
        console.log('✅ WebSocket сервер интегрирован на порту ' + PORT);
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Получен SIGTERM, сохраняем БД...');
    saveDb();
    server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Получен SIGINT, сохраняем БД...');
    saveDb();
    server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});
