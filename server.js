const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const formidable = require('formidable');
const Database = require('better-sqlite3');

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// База данных
const db = new Database(path.join(__dirname, 'data', 'database.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        bio TEXT DEFAULT '',
        avatarUrl TEXT,
        createdAt TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        content TEXT NOT NULL,
        imageUrl TEXT,
        date TEXT NOT NULL,
        time TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS likes (
        userId TEXT NOT NULL,
        postId TEXT NOT NULL,
        time TEXT NOT NULL,
        PRIMARY KEY (userId, postId)
    );
    
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        fromUserId TEXT NOT NULL,
        toUserId TEXT NOT NULL,
        text TEXT NOT NULL,
        time TEXT NOT NULL,
        read INTEGER DEFAULT 0
    );
`);

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
            maxFileSize: 10 * 1024 * 1024,
            allowEmptyFiles: false
        });
        form.parse(req, (err, fields, files) => {
            if (err) { resolve({ fields: {}, files: {} }); return; }
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
    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) return null;
    return db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId);
}

function serveFile(res, filePath, contentType) {
    const fullPath = path.join(__dirname, filePath);
    fs.readFile(fullPath, 'utf8', (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Ошибка');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
        res.end(data, 'utf8');
    });
}

function serveBinaryFile(res, filePath) {
    const fullPath = path.join(__dirname, filePath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const stream = fs.createReadStream(fullPath);
    stream.on('error', () => { res.writeHead(404); res.end('Not found'); });
    res.writeHead(200, { 'Content-Type': contentType });
    stream.pipe(res);
}

function serveJSON(res, data, status = 200) {
    const json = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(json, 'utf8');
}

const server = http.createServer(async (req, res) => {
    const url = req.url;
    const method = req.method;
    const currentUser = getAuth(req);

    // Загрузки
    if (url.startsWith('/uploads/') && method === 'GET') {
        return serveBinaryFile(res, 'public' + url);
    }

    // Регистрация
    if (url === '/api/register' && method === 'POST') {
        const { username, password } = await readBody(req);
        if (!username || !password) return serveJSON(res, { error: 'Логин и пароль обязательны' }, 400);
        if (username.length < 3) return serveJSON(res, { error: 'Логин минимум 3 символа' }, 400);
        if (password.length < 4) return serveJSON(res, { error: 'Пароль минимум 4 символа' }, 400);
        if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return serveJSON(res, { error: 'Пользователь уже существует' }, 400);

        const userId = Date.now().toString();
        db.prepare('INSERT INTO users (id, username, password, bio, avatarUrl, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(userId, username, hashPassword(password), '', null, new Date().toISOString());
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT OR REPLACE INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)').run(token, userId, new Date().toISOString());
        return serveJSON(res, { success: true, token, user: { id: userId, username } });
    }

    // Вход
    if (url === '/api/login' && method === 'POST') {
        const { username, password } = await readBody(req);
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user || user.password !== hashPassword(password)) return serveJSON(res, { error: 'Неверный логин или пароль' }, 401);
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT OR REPLACE INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)').run(token, user.id, new Date().toISOString());
        return serveJSON(res, { success: true, token, user: { id: user.id, username: user.username } });
    }

    // Профиль
    if (url === '/api/me' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const today = new Date().toISOString().split('T')[0];
        const count = db.prepare('SELECT COUNT(*) as count FROM posts WHERE userId = ? AND date = ?').get(currentUser.id, today);
        return serveJSON(res, { user: { id: currentUser.id, username: currentUser.username, bio: currentUser.bio || '', avatarUrl: currentUser.avatarUrl, createdAt: currentUser.createdAt }, canPost: count.count === 0 });
    }

    if (url.match(/^\/api\/user\/[^/]+$/) && method === 'GET') {
        const userId = url.split('/')[3];
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) return serveJSON(res, { error: 'Пользователь не найден' }, 404);
        const posts = db.prepare('SELECT * FROM posts WHERE userId = ? ORDER BY time DESC').all(userId);
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
        return serveJSON(res, { id: user.id, username: user.username, bio: user.bio || '', avatarUrl: user.avatarUrl, createdAt: user.createdAt, totalPosts: posts.length, streak });
    }

    if (url.match(/^\/api\/user\/[^/]+\/posts$/) && method === 'GET') {
        const userId = url.split('/')[3];
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) return serveJSON(res, { error: 'Пользователь не найден' }, 404);
        const posts = db.prepare('SELECT * FROM posts WHERE userId = ? ORDER BY time DESC').all(userId).map(p => ({ ...p, author: user.username, authorAvatar: user.avatarUrl }));
        return serveJSON(res, posts);
    }

    // Посты
    if (url === '/api/post' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Войдите в аккаунт' }, 401);
        const today = new Date().toISOString().split('T')[0];
        if (db.prepare('SELECT COUNT(*) as count FROM posts WHERE userId = ? AND date = ?').get(currentUser.id, today).count > 0) return serveJSON(res, { error: 'Вы уже публиковали сегодня' }, 400);
        const { fields, files } = await parseFormData(req);
        const content = fields.content || '';
        if (!content.trim()) return serveJSON(res, { error: 'Пост не может быть пустым' }, 400);
        let imageUrl = null;
        if (files.image && files.image[0]) {
            const file = files.image[0];
            const ext = path.extname(file.originalFilename || '.jpg');
            const fileName = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
            fs.renameSync(file.filepath, path.join(UPLOADS_DIR, fileName));
            imageUrl = '/uploads/' + fileName;
        }
        const postId = Date.now().toString();
        db.prepare('INSERT INTO posts (id, userId, content, imageUrl, date, time) VALUES (?, ?, ?, ?, ?, ?)').run(postId, currentUser.id, content.trim(), imageUrl, today, new Date().toISOString());
        return serveJSON(res, { success: true, post: { id: postId, content: content.trim(), imageUrl, author: currentUser.username } });
    }

    if (url === '/api/posts' && method === 'GET') {
        const posts = db.prepare('SELECT posts.*, users.username as author, users.avatarUrl as authorAvatar FROM posts JOIN users ON posts.userId = users.id ORDER BY posts.time DESC').all();
        return serveJSON(res, posts);
    }

    // Удаление поста
    if (url.match(/^\/api\/post\/[^/]+$/) && method === 'DELETE') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const postId = url.split('/')[3];
        const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
        if (!post) return serveJSON(res, { error: 'Пост не найден' }, 404);
        if (post.userId !== currentUser.id) return serveJSON(res, { error: 'Это не ваш пост' }, 403);
        if (post.imageUrl) {
            const imgPath = path.join(__dirname, 'public', post.imageUrl);
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        }
        db.prepare('DELETE FROM likes WHERE postId = ?').run(postId);
        db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
        return serveJSON(res, { success: true });
    }

    // Лайки
    if (url === '/api/like' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const { postId } = await readBody(req);
        if (!postId) return serveJSON(res, { error: 'postId обязателен' }, 400);
        const existing = db.prepare('SELECT * FROM likes WHERE userId = ? AND postId = ?').get(currentUser.id, postId);
        if (existing) db.prepare('DELETE FROM likes WHERE userId = ? AND postId = ?').run(currentUser.id, postId);
        else db.prepare('INSERT INTO likes (userId, postId, time) VALUES (?, ?, ?)').run(currentUser.id, postId, new Date().toISOString());
        const count = db.prepare('SELECT COUNT(*) as count FROM likes WHERE postId = ?').get(postId).count;
        return serveJSON(res, { liked: !existing, count });
    }

    if (url === '/api/likes' && method === 'POST') {
        const { postIds } = await readBody(req);
        if (!postIds || !Array.isArray(postIds)) return serveJSON(res, {});
        const myLikes = currentUser ? db.prepare('SELECT postId FROM likes WHERE userId = ?').all(currentUser.id).map(r => r.postId) : [];
        const result = {};
        postIds.forEach(pid => { result[pid] = { count: db.prepare('SELECT COUNT(*) as count FROM likes WHERE postId = ?').get(pid).count, liked: myLikes.includes(pid) }; });
        return serveJSON(res, result);
    }

    // Настройки
    if (url === '/api/settings' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        return serveJSON(res, { username: currentUser.username, bio: currentUser.bio || '', avatarUrl: currentUser.avatarUrl });
    }

    if (url === '/api/settings' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            const { files } = await parseFormData(req);
            if (files.avatar && files.avatar[0]) {
                const file = files.avatar[0];
                const ext = path.extname(file.originalFilename || '.jpg');
                const fileName = 'avatar-' + currentUser.id + ext;
                if (currentUser.avatarUrl) { const oldPath = path.join(__dirname, 'public', currentUser.avatarUrl); if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); }
                fs.renameSync(file.filepath, path.join(UPLOADS_DIR, fileName));
                const avatarUrl = '/uploads/' + fileName;
                db.prepare('UPDATE users SET avatarUrl = ? WHERE id = ?').run(avatarUrl, currentUser.id);
                return serveJSON(res, { success: true, avatarUrl });
            }
            return serveJSON(res, { success: true });
        }
        const { username, password, bio } = await readBody(req);
        const newUsername = username !== undefined ? username.trim() : currentUser.username;
        const newPassword = password && password.trim() ? hashPassword(password.trim()) : currentUser.password;
        const newBio = bio !== undefined ? (bio || '').substring(0, 200) : (currentUser.bio || '');
        if (newUsername.length < 3) return serveJSON(res, { error: 'Имя минимум 3 символа' }, 400);
        const exists = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(newUsername, currentUser.id);
        if (exists) return serveJSON(res, { error: 'Имя занято' }, 400);
        if (password && password.trim() && password.trim().length < 4) return serveJSON(res, { error: 'Пароль минимум 4 символа' }, 400);
        db.prepare('UPDATE users SET username = ?, password = ?, bio = ? WHERE id = ?').run(newUsername, newPassword, newBio, currentUser.id);
        return serveJSON(res, { success: true, user: { id: currentUser.id, username: newUsername, bio: newBio, avatarUrl: currentUser.avatarUrl } });
    }

    // Сообщения
    if (url === '/api/dialogs' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const partners = db.prepare('SELECT DISTINCT CASE WHEN fromUserId = ? THEN toUserId ELSE fromUserId END as partnerId FROM messages WHERE fromUserId = ? OR toUserId = ?').all(currentUser.id, currentUser.id, currentUser.id);
        const dialogs = [];
        for (const p of partners) {
            const partner = db.prepare('SELECT * FROM users WHERE id = ?').get(p.partnerId);
            if (!partner) continue;
            const lastMsg = db.prepare('SELECT * FROM messages WHERE (fromUserId = ? AND toUserId = ?) OR (fromUserId = ? AND toUserId = ?) ORDER BY time DESC LIMIT 1').get(currentUser.id, p.partnerId, p.partnerId, currentUser.id);
            const unread = db.prepare('SELECT COUNT(*) as count FROM messages WHERE toUserId = ? AND fromUserId = ? AND read = 0').get(currentUser.id, p.partnerId).count;
            dialogs.push({ userId: partner.id, username: partner.username, avatarUrl: partner.avatarUrl, lastMessage: lastMsg ? lastMsg.text : '', lastTime: lastMsg ? lastMsg.time : '', unread });
        }
        dialogs.sort((a, b) => b.lastTime.localeCompare(a.lastTime));
        return serveJSON(res, dialogs);
    }

    if (url.startsWith('/api/messages/') && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const partnerId = url.split('/')[3];
        db.prepare('UPDATE messages SET read = 1 WHERE fromUserId = ? AND toUserId = ? AND read = 0').run(partnerId, currentUser.id);
        const messages = db.prepare('SELECT messages.*, u1.username as fromUsername, u2.username as toUsername FROM messages JOIN users u1 ON messages.fromUserId = u1.id JOIN users u2 ON messages.toUserId = u2.id WHERE (fromUserId = ? AND toUserId = ?) OR (fromUserId = ? AND toUserId = ?) ORDER BY time ASC').all(currentUser.id, partnerId, partnerId, currentUser.id);
        return serveJSON(res, messages);
    }

    if (url === '/api/messages' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const { to, text } = await readBody(req);
        if (!to || !text || !text.trim()) return serveJSON(res, { error: 'Получатель и текст обязательны' }, 400);
        if (to === currentUser.id) return serveJSON(res, { error: 'Нельзя себе' }, 400);
        const msgId = Date.now().toString();
        db.prepare('INSERT INTO messages (id, fromUserId, toUserId, text, time, read) VALUES (?, ?, ?, ?, ?, 0)').run(msgId, currentUser.id, to, text.trim(), new Date().toISOString());
        return serveJSON(res, { success: true, message: { id: msgId, from: currentUser.id, to, text: text.trim(), fromUsername: currentUser.username } });
    }

    if (url.startsWith('/api/users/search') && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const urlObj = new URL(url, 'http://localhost');
        const query = urlObj.searchParams.get('q') || '';
        const users = db.prepare('SELECT id, username FROM users WHERE username LIKE ? AND id != ? LIMIT 10').all('%' + query + '%', currentUser.id);
        return serveJSON(res, users);
    }

    if (url === '/api/unread' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const count = db.prepare('SELECT COUNT(*) as count FROM messages WHERE toUserId = ? AND read = 0').get(currentUser.id).count;
        return serveJSON(res, { count });
    }

    // Статика
    if (url === '/' || url === '/index.html') return serveFile(res, 'public/index.html', 'text/html');
    if (url === '/css/style.css') return serveFile(res, 'public/css/style.css', 'text/css');
    if (url === '/js/app.js') return serveFile(res, 'public/js/app.js', 'application/javascript');

    res.writeHead(404);
    res.end('Not found');
});

server.listen(3000, () => {
    console.log('Сервер: http://localhost:3000');
});