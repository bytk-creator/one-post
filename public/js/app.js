// ========== УТИЛИТЫ ==========
let token = localStorage.getItem('token') || '';

function setToken(t) { token = t; }

async function api(url, method = 'GET', body = null) {
    const h = {};
    if (body && !(body instanceof FormData)) h['Content-Type'] = 'application/json';
    if (token) h['Authorization'] = 'Bearer ' + token;
    const o = { method, headers: h };
    if (body) o.body = body instanceof FormData ? body : JSON.stringify(body);
    const r = await fetch(url, o);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Ошибка');
    return d;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function onlineDot(online) { return online ? '<span style="display:inline-block;width:10px;height:10px;background:#10B981;border-radius:50%;margin-left:6px;flex-shrink:0;" title="Онлайн"></span>' : ''; }

// ========== ТЕМА ==========
function applyTheme(dark) {
    const toggle = document.getElementById('themeToggle');
    if (dark) { document.documentElement.setAttribute('data-theme', 'dark'); if (toggle) toggle.checked = true; }
    else { document.documentElement.removeAttribute('data-theme'); if (toggle) toggle.checked = false; }
}
(function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') applyTheme(true);
    else if (saved === 'light') applyTheme(false);
    else if (matchMedia('(prefers-color-scheme: dark)').matches) applyTheme(true);
    else applyTheme(false);
})();

// ========== СОСТОЯНИЕ ==========
let currentUser = null;
let currentChatPartner = null;
let unreadInterval = null;
let canPostToday = true;
let selectedPhoto = null;
let chatPhoto = null;
let lastMessagesHash = '';
let messagesHasMore = true;
let messagesLoading = false;
let feedPage = 1;
let feedHasMore = true;
let feedLoading = false;
let feedObserver = null;

const authBlock = document.getElementById('authBlock');
const appBlock = document.getElementById('appBlock');
const sidebarBtns = document.querySelectorAll('.sidebar-btn');
const msgBadge = document.getElementById('msgBadge');

// ========== НАВИГАЦИЯ ==========
function navigate(page, pushState = true) {
    if (pushState) history.pushState({ page }, '', page === 'feed' ? '/' : '/' + page);
    
    sidebarBtns.forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-page="${page}"]`);
    if (btn) btn.classList.add('active');
    
    ['feedPage', 'profilePage', 'messagesPage', 'settingsPage'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    
    const target = document.getElementById(page === 'feed' ? 'feedPage' : page + 'Page');
    if (target) target.classList.remove('hidden');
    
    if (page === 'feed') loadFeed();
    else if (page === 'messages') loadDialogs();
    else if (page === 'settings') loadSettings();
    
    if (page !== 'messages') {
        const ds = document.getElementById('dialogsSidebar');
        const ml = document.getElementById('messagesLayout');
        if (ds) ds.classList.remove('chat-open');
        if (ml) ml.classList.remove('mobile-view');
    }
}

sidebarBtns.forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.page));
});

window.addEventListener('popstate', () => {
    const path = location.pathname.replace('/', '');
    navigate(path || 'feed', false);
});

// ========== АВТОРИЗАЦИЯ ==========
document.getElementById('themeToggle')?.addEventListener('change', () => {
    const d = document.getElementById('themeToggle').checked;
    applyTheme(d);
    localStorage.setItem('theme', d ? 'dark' : 'light');
});

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('loginForm').classList.toggle('hidden', btn.dataset.tab !== 'login');
        document.getElementById('registerForm').classList.toggle('hidden', btn.dataset.tab !== 'register');
    });
});

let captchaAnswer = 0;
function generateCaptcha() {
    const a = Math.floor(Math.random() * 10) + 1;
    const b = Math.floor(Math.random() * 10) + 1;
    captchaAnswer = a + b;
    const el = document.getElementById('captchaQuestion');
    if (el) el.textContent = `Сколько будет ${a} + ${b}?`;
}
generateCaptcha();

document.getElementById('regPassword')?.addEventListener('input', function() {
    const p = this.value;
    const bar = document.querySelector('.strength-bar');
    const txt = document.querySelector('.strength-text');
    let score = 0;
    if (p.length >= 4) score++;
    if (p.length >= 8) score++;
    if (/[A-ZА-Я]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9А-Яа-я]/.test(p)) score++;
    const levels = [
        { w: '0%', c: '#E5E7EB', t: '' },
        { w: '25%', c: '#EF4444', t: 'Слабый' },
        { w: '50%', c: '#F59E0B', t: 'Средний' },
        { w: '75%', c: '#3B82F6', t: 'Хороший' },
        { w: '100%', c: '#10B981', t: 'Надёжный' }
    ];
    const l = levels[Math.min(score, 4)];
    if (bar) bar.style.width = l.w;
    if (bar) bar.style.background = l.c;
    if (txt) txt.textContent = l.t;
});

document.getElementById('registerFormEl')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('regUsername').value.trim();
    const p = document.getElementById('regPassword').value;
    const captcha = parseInt(document.getElementById('captchaAnswer').value);
    document.getElementById('registerError').textContent = '';
    
    if (!/^[a-zA-Z0-9_]+$/.test(u)) {
        document.getElementById('registerError').textContent = 'OneID: только английские буквы, цифры и _';
        return;
    }
    if (u.length < 3) {
        document.getElementById('registerError').textContent = 'OneID минимум 3 символа';
        return;
    }
    if (captcha !== captchaAnswer) {
        document.getElementById('registerError').textContent = 'Неверный ответ';
        generateCaptcha();
        document.getElementById('captchaAnswer').value = '';
        return;
    }
    
    try {
        const d = await api('/api/register', 'POST', { username: u, password: p });
        setToken(d.token);
        localStorage.setItem('token', d.token);
        enterApp(d.user);
    } catch (err) { document.getElementById('registerError').textContent = err.message; }
});

document.getElementById('loginFormEl')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value;
    document.getElementById('loginError').textContent = '';
    try {
        const d = await api('/api/login', 'POST', { username: u, password: p });
        setToken(d.token);
        localStorage.setItem('token', d.token);
        enterApp(d.user);
    } catch (err) { document.getElementById('loginError').textContent = err.message; }
});

// Выход
function logout() {
    localStorage.removeItem('token');
    setToken('');
    clearInterval(unreadInterval);
    appBlock.classList.add('hidden');
    authBlock.classList.remove('hidden');
    currentUser = null;
    history.pushState({}, '', '/');
}
document.getElementById('logoutBtnMobile')?.addEventListener('click', logout);
document.getElementById('logoutBtnDesktop')?.addEventListener('click', logout);

// ========== ВХОД В ПРИЛОЖЕНИЕ ==========
function enterApp(user) {
    currentUser = user;
    currentUser.id = String(currentUser.id);
    authBlock.classList.add('hidden');
    appBlock.classList.remove('hidden');
    startApp();
}

async function startApp() {
    try {
        const d = await api('/api/me', 'GET');
        currentUser = d.user;
        currentUser.id = String(currentUser.id);
        canPostToday = d.canPost;
        updateSidebar();
        updateCreatePostUI();
        
        const path = location.pathname.replace('/', '') || 'feed';
        navigate(path, false);
        
        updateUnreadBadge();
        unreadInterval = setInterval(updateUnreadBadge, 5000);
        setInterval(() => { if (token) api('/api/ping', 'POST').catch(() => {}); }, 30000);
        api('/api/ping', 'POST').catch(() => {});
    } catch (err) { logout(); }
}

function updateSidebar() {
    const a = currentUser.avatarUrl ? `<img src="${currentUser.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : currentUser.username.charAt(0).toUpperCase();
    document.getElementById('sidebarAvatar').innerHTML = a;
    document.getElementById('createPostAvatar').innerHTML = a;
    document.getElementById('sidebarUsername').textContent = currentUser.username;
}

function updateCreatePostUI() {
    const i = document.getElementById('openPostModal');
    if (i) {
        if (canPostToday) { i.textContent = 'Что у вас нового?'; i.style.color = '#818C99'; }
        else { i.textContent = 'Вы уже опубликовали пост сегодня'; i.style.color = '#999'; }
    }
}

// ========== МОДАЛКА ПОСТА ==========
document.getElementById('openPostModal')?.addEventListener('click', () => {
    const modal = document.getElementById('postModal');
    modal.classList.remove('hidden');
    if (canPostToday) {
        document.getElementById('postTextarea').focus();
        document.getElementById('postLimitWarning').classList.add('hidden');
        document.getElementById('publishBtn').disabled = false;
    } else {
        document.getElementById('postLimitWarning').classList.remove('hidden');
        document.getElementById('publishBtn').disabled = true;
    }
});

document.getElementById('closeModal')?.addEventListener('click', closeModalFn);
document.getElementById('postModal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModalFn(); });

function closeModalFn() {
    document.getElementById('postModal').classList.add('hidden');
    document.getElementById('postTextarea').value = '';
    clearPostPhoto();
}

function clearPostPhoto() {
    selectedPhoto = null;
    document.getElementById('photoInput').value = '';
    document.getElementById('photoPreview').classList.add('hidden');
    document.getElementById('photoLabel').classList.remove('has-photo');
}

document.getElementById('photoInput')?.addEventListener('change', () => {
    const f = document.getElementById('photoInput').files[0];
    if (f) {
        selectedPhoto = f;
        const r = new FileReader();
        r.onload = (e) => {
            document.getElementById('photoPreviewImg').src = e.target.result;
            document.getElementById('photoPreview').classList.remove('hidden');
            document.getElementById('photoLabel').classList.add('has-photo');
        };
        r.readAsDataURL(f);
    }
});

document.getElementById('removePhoto')?.addEventListener('click', clearPostPhoto);

document.getElementById('publishBtn')?.addEventListener('click', async () => {
    const c = document.getElementById('postTextarea').value.trim();
    if (!c) return;
    document.getElementById('publishBtn').disabled = true;
    try {
        const fd = new FormData();
        fd.append('content', c);
        if (selectedPhoto) fd.append('image', selectedPhoto);
        await api('/api/post', 'POST', fd);
        document.getElementById('postModal').classList.add('hidden');
        document.getElementById('postTextarea').value = '';
        clearPostPhoto();
        canPostToday = false;
        updateCreatePostUI();
        feedPage = 1;
        feedHasMore = true;
        loadFeed();
    } catch (err) { alert(err.message); document.getElementById('publishBtn').disabled = false; }
});

// ========== ЛЕНТА ==========
async function loadFeed(append = false) {
    if (feedLoading) return;
    feedLoading = true;
    const container = document.getElementById('feedContainer');
    if (!append) showSkeletons();
    try {
        const posts = await api('/api/posts?page=' + feedPage, 'GET');
        if (!append) {
            container.innerHTML = '<div class="feed-title">Новости</div>';
            if (!posts || !posts.length) {
                container.innerHTML = '<div class="empty-feed"><div class="empty-icon"><svg viewBox="0 0 80 80" width="64" height="64"><rect x="12" y="16" width="56" height="48" rx="8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><line x1="24" y1="32" x2="56" y2="32" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><line x1="24" y1="42" x2="48" y2="42" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/></svg></div><h3>Лента пуста</h3><p>Станьте первым!</p></div>';
                feedLoading = false; return;
            }
        }
        if (!posts || !posts.length) { feedHasMore = false; feedLoading = false; return; }
        const ids = posts.map(p => p.id);
        const likesData = await api('/api/likes', 'POST', { postIds: ids });
        posts.forEach((post, i) => {
            const div = document.createElement('div');
            div.className = 'post-card';
            if (!append) div.style.animationDelay = (i * 0.05) + 's';
            const li = likesData[post.id] || { count: 0, liked: false };
            const av = post.authorAvatar ? `<img src="${post.authorAvatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" loading="lazy">` : post.author.charAt(0).toUpperCase();
            const del = (currentUser && String(post.userId) === String(currentUser.id)) ? `<button class="post-delete-btn"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6h14M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
            div.innerHTML = `<div class="post-header"><div class="post-avatar" data-userid="${post.userId}">${av}</div><div class="post-author-info"><div class="post-author" data-userid="${post.userId}">${esc(post.author)}</div><div class="post-time">${formatTime(post.time)}</div></div><div class="post-header-right">${del}</div></div><div class="post-body"><div class="post-text">${esc(post.content)}</div>${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}</div><div class="post-footer"><button class="like-btn ${li.liked ? 'liked' : ''}"><span class="like-icon">${li.liked ? '❤️' : '🤍'}</span><span class="like-count">${li.count > 0 ? li.count : ''}</span></button></div>`;
            div.querySelectorAll('[data-userid]').forEach(el => el.addEventListener('click', (e) => { if (!e.target.closest('.like-btn') && !e.target.closest('.post-delete-btn')) viewProfile(post.userId); }));
            div.querySelector('.like-btn').addEventListener('click', async function() { try { const r = await api('/api/like', 'POST', { postId: post.id }); const ic = this.querySelector('.like-icon'); const ct = this.querySelector('.like-count'); if (r.liked) { this.classList.add('liked', 'just-liked'); ic.textContent = '❤️'; setTimeout(() => this.classList.remove('just-liked'), 400); } else { this.classList.remove('liked'); ic.textContent = '🤍'; } ct.textContent = r.count > 0 ? r.count : ''; } catch (err) {} });
            const db = div.querySelector('.post-delete-btn');
            if (db) db.addEventListener('click', async () => { if (confirm('Удалить?')) { try { await api('/api/post/' + post.id, 'DELETE'); feedPage = 1; feedHasMore = true; loadFeed(); } catch (err) { alert(err.message); } } });
            container.appendChild(div);
        });
        feedPage++;
        if (posts.length < 20) feedHasMore = false;
        setupFeedObserver();
    } catch (err) { if (!append) container.innerHTML = '<div class="empty-feed"><h3>Ошибка</h3></div>'; }
    feedLoading = false;
}

function showSkeletons() {
    const container = document.getElementById('feedContainer');
    container.innerHTML = '<div class="feed-title">Новости</div>' + '<div class="skeleton skeleton-card"></div>'.repeat(3);
}

function setupFeedObserver() {
    if (feedObserver) feedObserver.disconnect();
    const sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    document.getElementById('feedContainer').appendChild(sentinel);
    feedObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && feedHasMore && !feedLoading) loadFeed(true);
    }, { rootMargin: '200px' });
    feedObserver.observe(sentinel);
}

function formatTime(iso) {
    return new Date(iso).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
}

// ========== ПРОФИЛЬ ==========
async function viewProfile(userId) {
    navigate('profile', true);
    const profilePage = document.getElementById('profilePage');
    profilePage.innerHTML = '<div class="skeleton" style="height:200px;border-radius:16px;"></div>';
    try {
        const user = await api('/api/user/' + userId, 'GET');
        const jd = new Date(user.createdAt).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
        const sn = user.username.replace(/'/g, "\\'");
        let mb = '';
        if (currentUser && String(userId) !== String(currentUser.id)) mb = `<button class="btn-msg" onclick="msgFromProfile('${userId}','${sn}')">Написать</button>`;
        const av = user.avatarUrl ? `<div class="profile-avatar-wrapper"><img src="${user.avatarUrl}" alt="Аватар" loading="lazy"></div>` : `<div class="profile-avatar-placeholder">${user.username.charAt(0).toUpperCase()}</div>`;
        profilePage.innerHTML = `<div class="profile-card">${av}<div class="profile-name">${esc(user.username)}${onlineDot(user.online)}</div>${user.bio ? `<div class="profile-bio">${esc(user.bio)}</div>` : ''}<div class="profile-date">На сайте с ${jd}</div><div class="profile-stats"><div><div class="stat-num">${user.totalPosts}</div><div class="stat-label">постов</div></div><div><div class="stat-num">${user.streak}🔥</div><div class="stat-label">дней</div></div></div><div class="profile-btns">${mb}<button class="btn-back-profile" onclick="goToFeed()">← Назад</button></div></div>`;
        const posts = await api('/api/user/' + userId + '/posts', 'GET');
        const pc = document.createElement('div');
        pc.className = 'profile-posts';
        if (!posts || !posts.length) { pc.innerHTML = '<div class="empty-feed"><h3>Нет постов</h3></div>'; }
        else {
            const ids = posts.map(p => p.id);
            const likesData = await api('/api/likes', 'POST', { postIds: ids });
            posts.forEach(post => {
                const div = document.createElement('div');
                div.className = 'post-card';
                const li = likesData[post.id] || { count: 0, liked: false };
                const del = (currentUser && String(post.userId) === String(currentUser.id)) ? `<button class="post-delete-btn"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6h14M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
                div.innerHTML = `<div class="post-body"><div class="post-text">${esc(post.content)}</div>${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}<div class="post-time">${formatTime(post.time)}</div></div><div class="post-footer" style="display:flex;align-items:center;justify-content:space-between;"><button class="like-btn ${li.liked ? 'liked' : ''}"><span class="like-icon">${li.liked ? '❤️' : '🤍'}</span><span class="like-count">${li.count > 0 ? li.count : ''}</span></button>${del}</div>`;
                div.querySelector('.like-btn').addEventListener('click', async function() { try { const r = await api('/api/like', 'POST', { postId: post.id }); const ic = this.querySelector('.like-icon'); const ct = this.querySelector('.like-count'); if (r.liked) { this.classList.add('liked', 'just-liked'); ic.textContent = '❤️'; setTimeout(() => this.classList.remove('just-liked'), 400); } else { this.classList.remove('liked'); ic.textContent = '🤍'; } ct.textContent = r.count > 0 ? r.count : ''; } catch (err) {} });
                const db = div.querySelector('.post-delete-btn');
                if (db) db.addEventListener('click', async () => { if (confirm('Удалить?')) { try { await api('/api/post/' + post.id, 'DELETE'); viewProfile(userId); } catch (err) { alert(err.message); } } });
                pc.appendChild(div);
            });
        }
        profilePage.appendChild(pc);
    } catch (err) { profilePage.innerHTML = '<div class="empty-feed"><h3>Не найден</h3></div>'; }
}

function msgFromProfile(uid, un) { navigate('messages'); openChat(uid, un); if (innerWidth <= 768) { document.getElementById('dialogsSidebar').classList.add('chat-open'); document.getElementById('messagesLayout').classList.add('mobile-view'); } }
function goToFeed() { navigate('feed'); }

// ========== НАСТРОЙКИ ==========
async function loadSettings() {
    try {
        const d = await api('/api/settings', 'GET');
        document.getElementById('settingsUsername').value = d.username;
        document.getElementById('settingsBio').value = d.bio || '';
        updateSA(d.avatarUrl, d.username);
    } catch (err) {}
}

function updateSA(url, name) {
    const container = document.getElementById('settingsAvatarContainer');
    if (url) container.innerHTML = `<img src="${url}" class="settings-avatar-img" alt="Аватар">`;
    else container.innerHTML = `<div class="settings-avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`;
}

document.getElementById('avatarInput')?.addEventListener('change', async () => {
    const f = document.getElementById('avatarInput').files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('avatar', f);
    try {
        const r = await fetch('/api/settings', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        currentUser.avatarUrl = d.avatarUrl;
        updateSA(d.avatarUrl, currentUser.username);
        updateSidebar();
        showOk('Аватар обновлён!');
    } catch (err) { alert(err.message); }
});

document.getElementById('saveProfile')?.addEventListener('click', async () => {
    const u = document.getElementById('settingsUsername').value.trim();
    const b = document.getElementById('settingsBio').value.trim();
    if (!/^[a-zA-Z0-9_]+$/.test(u)) return alert('OneID: только английские буквы, цифры и _');
    if (u.length < 3) return alert('OneID от 3 символов');
    try {
        const d = await api('/api/settings', 'POST', { username: u, bio: b });
        currentUser = d.user;
        currentUser.id = String(currentUser.id);
        updateSidebar();
        showOk('Сохранено!');
    } catch (err) { alert(err.message); }
});

document.getElementById('savePassword')?.addEventListener('click', async () => {
    const p = document.getElementById('settingsPassword').value.trim();
    if (!p) return alert('Введите пароль');
    if (p.length < 4) return alert('От 4 символов');
    try {
        await api('/api/settings', 'POST', { password: p });
        document.getElementById('settingsPassword').value = '';
        showOk('Пароль изменён!');
    } catch (err) { alert(err.message); }
});

function showOk(m) {
    const el = document.getElementById('settingsSuccess');
    el.textContent = '✅ ' + m;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

// ========== СООБЩЕНИЯ ==========
async function updateUnreadBadge() {
    try {
        const d = await api('/api/unread', 'GET');
        if (msgBadge) {
            msgBadge.classList.toggle('hidden', !d.count);
            if (d.count) msgBadge.textContent = d.count;
        }
    } catch (err) {}
}

async function loadDialogs() {
    try {
        const dialogs = await api('/api/dialogs', 'GET');
        const list = document.getElementById('dialogsList');
        if (!list) return;
        list.innerHTML = '';
        if (!dialogs.length) { list.innerHTML = '<div class="no-dialogs">Нет диалогов</div>'; return; }
        dialogs.forEach(d => {
            const div = document.createElement('div');
            div.className = 'dialog-item';
            if (String(currentChatPartner) === String(d.userId)) div.classList.add('active');
            const t = d.lastTime ? new Date(d.lastTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
            div.innerHTML = `<div class="dialog-avatar">${d.avatarUrl ? `<img src="${d.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" loading="lazy">` : d.username.charAt(0).toUpperCase()}</div><div class="dialog-info"><div class="dialog-name">${esc(d.username)}${onlineDot(d.online)}</div><div class="dialog-last">${esc((d.lastMessage || '').substring(0, 30))}</div></div><div class="dialog-meta"><div class="dialog-time">${t}</div>${d.unread > 0 ? `<div class="unread-badge">${d.unread}</div>` : ''}</div>`;
            div.addEventListener('click', () => openChat(d.userId, d.username, d.avatarUrl));
            list.appendChild(div);
        });
    } catch (err) {}
}

let st;
document.getElementById('searchUserInput')?.addEventListener('input', function() {
    clearTimeout(st);
    const q = this.value.trim();
    const results = document.getElementById('searchResults');
    if (!q) { results.classList.add('hidden'); return; }
    st = setTimeout(async () => {
        try {
            const users = await api('/api/users/search?q=' + encodeURIComponent(q), 'GET');
            results.classList.remove('hidden');
            results.innerHTML = '';
            if (!users.length) { results.innerHTML = '<div class="search-result-item" style="color:var(--text-secondary);">Никого нет</div>'; return; }
            users.forEach(u => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px;';
                const av = u.avatarUrl ? `<img src="${u.avatarUrl}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;">` : `<div style="width:36px;height:36px;border-radius:50%;background:var(--avatar-gradient,linear-gradient(135deg,#4F6EF7,#7B8CFF));color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0;">${u.username.charAt(0).toUpperCase()}</div>`;
                div.innerHTML = av + '<span style="font-size:14px;font-weight:600;">' + esc(u.username) + '</span>';
                div.addEventListener('click', () => { openChat(u.id, u.username, u.avatarUrl); this.value = ''; results.classList.add('hidden'); });
                results.appendChild(div);
            });
        } catch (err) {}
    }, 300);
});

function openChat(uid, un, avUrl) {
    currentChatPartner = String(uid);
    lastMessagesHash = '';
    messagesHasMore = true;
    messagesLoading = false;
    const av = avUrl ? `<img src="${avUrl}" class="chat-partner-avatar-img" alt="" loading="lazy">` : `<div class="chat-partner-avatar-placeholder">${un.charAt(0).toUpperCase()}</div>`;
    const header = document.getElementById('chatPartnerText');
    if (header) {
        header.innerHTML = `<span class="chat-partner-info" data-userid="${uid}" style="display:flex;align-items:center;gap:10px;cursor:pointer;">${av}<span>${esc(un)}</span></span>`;
        header.querySelector('.chat-partner-info')?.addEventListener('click', (e) => { e.stopPropagation(); viewProfile(uid); });
    }
    const msgInput = document.getElementById('messageInput');
    if (msgInput) msgInput.disabled = false;
    loadMessages();
    loadDialogs();
    if (innerWidth <= 768) {
        document.getElementById('dialogsSidebar').classList.add('chat-open');
        document.getElementById('messagesLayout').classList.add('mobile-view');
    }
}

document.getElementById('chatBackBtn')?.addEventListener('click', () => {
    document.getElementById('dialogsSidebar').classList.remove('chat-open');
    document.getElementById('messagesLayout').classList.remove('mobile-view');
    currentChatPartner = null;
    lastMessagesHash = '';
    document.getElementById('chatPartnerText').textContent = 'Выберите диалог';
    document.getElementById('messageInput').disabled = true;
    document.getElementById('sendMessageBtn').disabled = true;
    document.getElementById('chatMessages').innerHTML = '<div class="chat-empty">Выберите диалог или найдите пользователя</div>';
});

document.getElementById('messageInput')?.addEventListener('input', function() {
    document.getElementById('sendMessageBtn').disabled = !(this.value.trim() || chatPhoto);
});

async function loadMessages(before = null, prepend = false) {
    if (!currentChatPartner) return;
    if (messagesLoading) return;
    messagesLoading = true;
    let url = '/api/messages/' + currentChatPartner;
    if (before) url += '?before=' + encodeURIComponent(before);
    try {
        const data = await api(url);
        const msgs = data.messages;
        messagesHasMore = data.hasMore;
        const container = document.getElementById('chatMessages');
        if (!prepend) {
            const hash = JSON.stringify(msgs);
            if (hash === lastMessagesHash) { messagesLoading = false; return; }
            lastMessagesHash = hash;
            container.innerHTML = msgs.length ? '' : '<div class="chat-empty">Напишите первым!</div>';
        }
        const frag = document.createDocumentFragment();
        msgs.forEach(m => {
            const div = document.createElement('div');
            div.className = 'message ' + (String(m.from) === String(currentUser.id) ? 'message-sent' : 'message-received');
            div.dataset.msgTime = m.time;
            const t = new Date(m.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            div.innerHTML = (m.text ? esc(m.text) : '') + (m.imageUrl ? `<img src="${m.imageUrl}" class="message-image" alt="Фото" loading="lazy">` : '') + `<div class="message-time">${t}</div>`;
            frag.appendChild(div);
        });
        if (prepend) {
            const oh = container.scrollHeight;
            container.insertBefore(frag, container.firstChild);
            container.scrollTop = container.scrollHeight - oh;
        } else {
            container.appendChild(frag);
            container.scrollTop = container.scrollHeight;
        }
        updateUnreadBadge();
    } catch (err) {}
    messagesLoading = false;
}

document.getElementById('chatMessages')?.addEventListener('scroll', function() {
    if (this.scrollTop < 100 && messagesHasMore && !messagesLoading) {
        const fm = this.querySelector('.message');
        if (fm && fm.dataset.msgTime) loadMessages(fm.dataset.msgTime, true);
    }
});

async function sendMsg() {
    const input = document.getElementById('messageInput');
    const t = input.value.trim();
    if ((!t && !chatPhoto) || !currentChatPartner) return;
    try {
        if (chatPhoto) {
            const fd = new FormData();
            fd.append('to', currentChatPartner);
            fd.append('text', t || '');
            fd.append('image', chatPhoto);
            const r = await fetch('/api/messages/photo', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
            if (!r.ok) throw new Error((await r.json()).error);
        } else {
            await api('/api/messages', 'POST', { to: currentChatPartner, text: t });
        }
        input.value = '';
        chatPhoto = null;
        document.getElementById('chatPhotoInput').value = '';
        document.getElementById('chatPhotoPreview').classList.add('hidden');
        lastMessagesHash = '';
        loadMessages();
        loadDialogs();
    } catch (err) { alert(err.message); }
}

document.getElementById('sendMessageBtn')?.addEventListener('click', sendMsg);
document.getElementById('messageInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMsg(); });
document.getElementById('chatAttachBtn')?.addEventListener('click', () => document.getElementById('chatPhotoInput').click());
document.getElementById('chatPhotoInput')?.addEventListener('change', function() {
    const f = this.files[0];
    if (!f) return;
    chatPhoto = f;
    const r = new FileReader();
    r.onload = (e) => {
        document.getElementById('chatPhotoPreviewImg').src = e.target.result;
        document.getElementById('chatPhotoPreview').classList.remove('hidden');
        document.getElementById('sendMessageBtn').disabled = false;
    };
    r.readAsDataURL(f);
});
document.getElementById('chatRemovePhoto')?.addEventListener('click', () => {
    chatPhoto = null;
    document.getElementById('chatPhotoInput').value = '';
    document.getElementById('chatPhotoPreview').classList.add('hidden');
    document.getElementById('sendMessageBtn').disabled = !document.getElementById('messageInput').value.trim();
});

setInterval(() => {
    if (currentChatPartner && !document.getElementById('messagesPage').classList.contains('hidden')) {
        const cm = document.getElementById('chatMessages');
        if (cm && cm.scrollTop > cm.scrollHeight - cm.clientHeight - 200) loadMessages();
    }
}, 3000);

setInterval(() => {
    if (!document.getElementById('messagesPage').classList.contains('hidden')) loadDialogs();
}, 5000);

// ========== ЗАПУСК ==========
// Ничего не делаем — роутер сам запустится через проверку токена
