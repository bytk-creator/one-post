let token = localStorage.getItem('token') || '';
let currentUser = null;
let currentChatPartner = null;
let unreadInterval = null;
let viewingUserId = null;
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
let replyTo = null;
let notifiedMsgIds = new Set();

// ===== WEBSOCKET ПЕРЕМЕННЫЕ =====
let ws = null;
let wsConnected = false;
let wsReconnectTimer = null;
let typingTimer = null;
let typingIndicatorEl = null;

// ===== ГОЛОСОВЫЕ ПЕРЕМЕННЫЕ =====
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let voiceBtn = null;

// ===== DOM ЭЛЕМЕНТЫ =====
const authBlock = document.getElementById('authBlock');
const appBlock = document.getElementById('appBlock');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const tabBtns = document.querySelectorAll('.tab-btn');

let captchaAnswer = 0;
function generateCaptcha() {
    const a = Math.floor(Math.random() * 10) + 1;
    const b = Math.floor(Math.random() * 10) + 1;
    captchaAnswer = a + b;
    document.getElementById('captchaQuestion').textContent = `Сколько будет ${a} + ${b}?`;
}
generateCaptcha();

const msgBadge = document.getElementById('msgBadge');
const feedPageEl = document.getElementById('feedPage');
const profilePage = document.getElementById('profilePage');
const messagesPage = document.getElementById('messagesPage');
const settingsPage = document.getElementById('settingsPage');
const sidebarBtns = document.querySelectorAll('.sidebar-btn');
const postModal = document.getElementById('postModal');
const postTextarea = document.getElementById('postTextarea');
const publishBtn = document.getElementById('publishBtn');
const postLimitWarning = document.getElementById('postLimitWarning');
const feedContainer = document.getElementById('feedContainer');
const photoInput = document.getElementById('photoInput');
const photoLabel = document.getElementById('photoLabel');
const photoPreview = document.getElementById('photoPreview');
const photoPreviewImg = document.getElementById('photoPreviewImg');
const removePhoto = document.getElementById('removePhoto');
const messagesLayout = document.getElementById('messagesLayout');
const dialogsSidebar = document.getElementById('dialogsSidebar');
const dialogsList = document.getElementById('dialogsList');
const chatBackBtn = document.getElementById('chatBackBtn');
const chatCloseBtn = document.getElementById('chatCloseBtn');
const chatPartnerText = document.getElementById('chatPartnerText');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const searchUserInput = document.getElementById('searchUserInput');
const searchResults = document.getElementById('searchResults');
const chatAttachBtn = document.getElementById('chatAttachBtn');
const chatPhotoInput = document.getElementById('chatPhotoInput');
const chatPhotoPreview = document.getElementById('chatPhotoPreview');
const chatPhotoPreviewImg = document.getElementById('chatPhotoPreviewImg');
const chatRemovePhoto = document.getElementById('chatRemovePhoto');
const replyPreview = document.getElementById('replyPreview');
const replyPreviewText = document.getElementById('replyPreviewText');
const replyPreviewClose = document.getElementById('replyPreviewClose');
const settingsUsername = document.getElementById('settingsUsername');
const settingsBio = document.getElementById('settingsBio');
const settingsPassword = document.getElementById('settingsPassword');
const settingsAvatarContainer = document.getElementById('settingsAvatarContainer');
const avatarInput = document.getElementById('avatarInput');
const coverInput = document.getElementById('coverInput');
const settingsSuccess = document.getElementById('settingsSuccess');
const saveProfile = document.getElementById('saveProfile');
const themeToggle = document.getElementById('themeToggle');
const logoutBtnMobile = document.getElementById('logoutBtnMobile');
const logoutBtnDesktop = document.getElementById('logoutBtnDesktop');
const sidebarCollapse = document.getElementById('sidebarCollapse');
const sidebar = document.querySelector('.sidebar');
const micBtn = document.getElementById('micBtn');

// ===== ТЕМА =====
function applyTheme(dark) {
    if (dark) { 
        document.documentElement.setAttribute('data-theme', 'dark'); 
        if (themeToggle) themeToggle.checked = true; 
    } else { 
        document.documentElement.removeAttribute('data-theme'); 
        if (themeToggle) themeToggle.checked = false; 
    }
}

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') applyTheme(true);
else if (savedTheme === 'light') applyTheme(false);
else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme(true);
else applyTheme(false);

themeToggle?.addEventListener('change', () => { 
    const d = themeToggle.checked; 
    applyTheme(d); 
    localStorage.setItem('theme', d ? 'dark' : 'light'); 
});

// ===== САЙДБАР =====
sidebarCollapse?.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
});

if (localStorage.getItem('sidebarCollapsed') === 'true') {
    sidebar?.classList.add('collapsed');
}

// ===== ТАБЫ АВТОРИЗАЦИИ =====
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active')); 
        btn.classList.add('active');
        loginForm.classList.toggle('hidden', btn.dataset.tab !== 'login');
        registerForm.classList.toggle('hidden', btn.dataset.tab !== 'register');
    });
});

// ===== ПРОВЕРКА ПАРОЛЯ =====
document.getElementById('regPassword').addEventListener('input', function() {
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
    bar.style.width = l.w;
    bar.style.background = l.c;
    txt.textContent = l.t;
});

// ===== API ВЫЗОВЫ =====
async function apiCall(url, method, body = null) {
    const h = {};
    if (body && !(body instanceof FormData)) {
        h['Content-Type'] = 'application/json';
    }
    if (token) {
        h['Authorization'] = 'Bearer ' + token;
    }
    
    const o = { method, headers: h };
    if (body) {
        o.body = body instanceof FormData ? body : JSON.stringify(body);
    }
    
    try {
        const r = await fetch(url, o);
        const contentType = r.headers.get('content-type') || '';
        
        if (!contentType.includes('application/json')) {
            const text = await r.text();
            console.error('❌ Сервер вернул не JSON:', text.substring(0, 200));
            throw new Error('Ошибка сервера. Попробуйте позже.');
        }
        
        const d = await r.json();
        
        if (!r.ok) {
            throw new Error(d.error || 'Ошибка сервера');
        }
        
        return d;
    } catch (err) {
        if (err instanceof SyntaxError) {
            console.error('❌ Ошибка парсинга JSON');
            throw new Error('Сервер временно недоступен');
        }
        throw err;
    }
}

// ===== РЕГИСТРАЦИЯ =====
document.getElementById('registerFormEl').addEventListener('submit', async (e) => {
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
        document.getElementById('registerError').textContent = 'Неверный ответ на вопрос';
        generateCaptcha();
        document.getElementById('captchaAnswer').value = '';
        return;
    }
    
    try {
        const d = await apiCall('/api/register', 'POST', { username: u, password: p });
        token = d.token; 
        localStorage.setItem('token', token);
        enterApp(d.user);
    } catch (err) { 
        document.getElementById('registerError').textContent = err.message; 
        generateCaptcha();
        document.getElementById('captchaAnswer').value = '';
    }
});

// ===== ВХОД =====
document.getElementById('loginFormEl').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value;
    document.getElementById('loginError').textContent = '';
    try {
        const d = await apiCall('/api/login', 'POST', { username: u, password: p });
        token = d.token; 
        localStorage.setItem('token', token);
        enterApp(d.user);
    } catch (err) { 
        document.getElementById('loginError').textContent = err.message; 
    }
});

// ===== ВЫХОД =====
function logout() {
    localStorage.removeItem('token');
    token = '';
    clearInterval(unreadInterval);
    if (ws) {
        ws.close();
        ws = null;
    }
    wsConnected = false;
    appBlock.classList.add('hidden');
    authBlock.classList.remove('hidden');
    currentUser = null;
    currentChatPartner = null;
    history.pushState({}, '', '/');
}
logoutBtnMobile.addEventListener('click', logout);
logoutBtnDesktop.addEventListener('click', logout);

// ===== ВХОД В ПРИЛОЖЕНИЕ =====
function enterApp(user) {
    currentUser = user;
    currentUser.id = String(currentUser.id);
    authBlock.classList.add('hidden');
    appBlock.classList.remove('hidden');
    
    updateAllUI();
    updateCreatePostUI();
    loadFeed();
    startApp();
}

async function startApp() {
    try {
        if (!token) {
            console.log('⚠️ Нет токена');
            return;
        }
        
        const d = await apiCall('/api/me', 'GET');
        
        if (!d || !d.user) {
            console.error('❌ Некорректный ответ от /api/me');
            return;
        }
        
        currentUser = d.user; 
        currentUser.id = String(currentUser.id); 
        canPostToday = d.canPost;
        
        updateAllUI(); 
        updateCreatePostUI();
        
        unreadInterval = setInterval(updateUnreadBadge, 5000);
        setInterval(() => { if (token) apiCall('/api/ping', 'POST').catch(() => {}); }, 30000);
        apiCall('/api/ping', 'POST').catch(() => {});
        
        setTimeout(() => connectWebSocket(), 500);
        setupVoiceButton();
        
        console.log('✅ Приложение запущено');
    } catch (err) {
        console.error('❌ Ошибка запуска:', err.message);
    }
}

function updateAllUI() {
    if (!currentUser) return;
    const a = currentUser.avatarUrl ? 
        `<img src="${currentUser.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : 
        currentUser.username.charAt(0).toUpperCase();
    document.getElementById('sidebarAvatar').innerHTML = a;
    document.getElementById('createPostAvatar').innerHTML = a;
    document.getElementById('sidebarUsername').textContent = currentUser.username;
    
    const footer = document.querySelector('.sidebar-footer');
    if (footer) {
        footer.style.cursor = 'pointer';
        footer.onclick = () => viewProfile(currentUser.id);
    }
}

function updateCreatePostUI() {
    const i = document.getElementById('openPostModal');
    if (canPostToday) { 
        i.textContent = 'Что у вас нового?'; 
        i.style.color = '#818C99'; 
    } else { 
        i.textContent = 'Вы уже опубликовали пост сегодня'; 
        i.style.color = '#999'; 
    }
}

// ===== НАВИГАЦИЯ =====
sidebarBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        history.pushState({ page }, '', page === 'feed' ? '/' : '/' + page);
        navigateFromURL(page);
    });
});

document.getElementById('openPostModal').addEventListener('click', () => {
    postModal.classList.remove('hidden');
    if (canPostToday) { 
        postTextarea.focus(); 
        postLimitWarning.classList.add('hidden'); 
        publishBtn.disabled = false; 
    } else { 
        postLimitWarning.classList.remove('hidden'); 
        publishBtn.disabled = true; 
    }
});

document.getElementById('closeModal').addEventListener('click', () => { 
    postModal.classList.add('hidden'); 
    postTextarea.value = ''; 
    clearPhoto(); 
});

postModal.addEventListener('click', (e) => { 
    if (e.target === postModal) { 
        postModal.classList.add('hidden'); 
        postTextarea.value = ''; 
        clearPhoto(); 
    } 
});

function clearPhoto() { 
    selectedPhoto = null; 
    photoInput.value = ''; 
    photoPreview.classList.add('hidden'); 
    photoLabel.classList.remove('has-photo'); 
}

photoInput.addEventListener('change', () => { 
    const f = photoInput.files[0]; 
    if (f) { 
        selectedPhoto = f; 
        const r = new FileReader(); 
        r.onload = (e) => { 
            photoPreviewImg.src = e.target.result; 
            photoPreview.classList.remove('hidden'); 
            photoLabel.classList.add('has-photo'); 
        }; 
        r.readAsDataURL(f); 
    } 
});

removePhoto.addEventListener('click', clearPhoto);

publishBtn.addEventListener('click', async () => {
    const c = postTextarea.value.trim(); 
    if (!c) return;
    publishBtn.disabled = true;
    try {
        const fd = new FormData(); 
        fd.append('content', c); 
        if (selectedPhoto) fd.append('image', selectedPhoto);
        await apiCall('/api/post', 'POST', fd);
        postTextarea.value = ''; 
        postModal.classList.add('hidden'); 
        clearPhoto(); 
        canPostToday = false; 
        updateCreatePostUI();
        feedPage = 1; 
        feedHasMore = true; 
        loadFeed();
    } catch (err) { 
        alert(err.message); 
        publishBtn.disabled = false; 
    }
});

// ===== ЛЕНТА =====
function showSkeletons() { 
    feedContainer.innerHTML = '<div class="feed-title">Новости</div>' + 
        '<div class="skeleton skeleton-card"></div>'.repeat(3); 
}

async function loadFeed(append = false) {
    if (feedLoading) return;
    feedLoading = true;
    if (!append) showSkeletons();
    try {
        const posts = await apiCall('/api/posts?page=' + feedPage, 'GET');
        if (!append) {
            feedContainer.innerHTML = '<div class="feed-title">Новости</div>';
            if (!posts || !posts.length) {
                feedContainer.innerHTML = '<div class="empty-feed"><div class="empty-icon"><svg viewBox="0 0 80 80" width="64" height="64"><rect x="12" y="16" width="56" height="48" rx="8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><line x1="24" y1="32" x2="56" y2="32" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><line x1="24" y1="42" x2="48" y2="42" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/></svg></div><h3>Лента пуста</h3><p>Станьте первым!</p></div>';
                feedLoading = false; 
                return;
            }
        }
        if (!posts || !posts.length) { 
            feedHasMore = false; 
            feedLoading = false; 
            return; 
        }
        
        const ids = posts.map(p => p.id); 
        const likesData = await apiCall('/api/likes', 'POST', { postIds: ids });
        
        posts.forEach((post, i) => {
            const div = document.createElement('div'); 
            div.className = 'post-card';
            if (!append) div.style.animationDelay = (i * 0.05) + 's';
            
            const ts = new Date(post.time).toLocaleString('ru-RU', { 
                hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' 
            });
            const li = likesData[post.id] || { count: 0, liked: false };
            const av = post.authorAvatar ? 
                `<img src="${post.authorAvatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" loading="lazy">` : 
                post.author.charAt(0).toUpperCase();
            const del = (currentUser && String(post.userId) === String(currentUser.id)) ? 
                `<button class="post-delete-btn"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6h14M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
            
            div.innerHTML = `
                <div class="post-header">
                    <div class="post-avatar" data-userid="${post.userId}">${av}</div>
                    <div class="post-author-info">
                        <div class="post-author" data-userid="${post.userId}">${esc(post.author)}</div>
                        <div class="post-time">${ts}</div>
                    </div>
                    <div class="post-header-right">${del}</div>
                </div>
                <div class="post-body">
                    <div class="post-text">${esc(post.content)}</div>
                    ${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}
                </div>
                <div class="post-footer">
                    <button class="like-btn ${li.liked ? 'liked' : ''}">
                        <span class="like-icon">${li.liked ? '❤️' : '🤍'}</span>
                        <span class="like-count">${li.count > 0 ? li.count : ''}</span>
                    </button>
                </div>`;
            
            div.querySelectorAll('[data-userid]').forEach(el => el.addEventListener('click', (e) => {
                if (!e.target.closest('.like-btn') && !e.target.closest('.post-delete-btn')) 
                    viewProfile(post.userId);
            }));
            
            div.querySelector('.like-btn').addEventListener('click', async function() { 
                try { 
                    const r = await apiCall('/api/like', 'POST', { postId: post.id }); 
                    const ic = this.querySelector('.like-icon'); 
                    const ct = this.querySelector('.like-count'); 
                    if (r.liked) { 
                        this.classList.add('liked', 'just-liked'); 
                        ic.textContent = '❤️'; 
                        setTimeout(() => this.classList.remove('just-liked'), 400); 
                    } else { 
                        this.classList.remove('liked'); 
                        ic.textContent = '🤍'; 
                    } 
                    ct.textContent = r.count > 0 ? r.count : ''; 
                } catch (err) {} 
            });
            
            const db = div.querySelector('.post-delete-btn'); 
            if (db) db.addEventListener('click', async () => { 
                if (confirm('Удалить?')) { 
                    try { 
                        await apiCall('/api/post/' + post.id, 'DELETE'); 
                        feedPage = 1; 
                        feedHasMore = true; 
                        loadFeed(); 
                    } catch (err) { 
                        alert(err.message); 
                    } 
                } 
            });
            
            feedContainer.appendChild(div);
        });
        
        feedPage++;
        if (posts.length < 20) feedHasMore = false;
        setupFeedObserver();
    } catch (err) { 
        if (!append) feedContainer.innerHTML = '<div class="empty-feed"><h3>Ошибка загрузки</h3></div>'; 
    }
    feedLoading = false;
}

function setupFeedObserver() {
    if (feedObserver) feedObserver.disconnect();
    const sentinel = document.createElement('div'); 
    sentinel.style.height = '1px';
    feedContainer.appendChild(sentinel);
    feedObserver = new IntersectionObserver((entries) => { 
        if (entries[0].isIntersecting && feedHasMore && !feedLoading) loadFeed(true); 
    }, { rootMargin: '200px' });
    feedObserver.observe(sentinel);
}

// ===== ПРОФИЛЬ =====
function onlineDot(online) {
    return online ? '<span style="display:inline-block;width:10px;height:10px;background:#10B981;border-radius:50%;margin-left:6px;" title="Онлайн"></span>' : '';
}

async function viewProfile(userId) {
    if (!currentUser) return;
    viewingUserId = userId;
    sidebarBtns.forEach(b => b.classList.remove('active'));
    feedPageEl.classList.add('hidden'); 
    messagesPage.classList.add('hidden'); 
    settingsPage.classList.add('hidden'); 
    profilePage.classList.remove('hidden');
    profilePage.innerHTML = '<div class="skeleton" style="height:200px;border-radius:16px;"></div>';
    
    try {
        const user = await apiCall('/api/user/' + userId, 'GET');
        const jd = new Date(user.createdAt).toLocaleDateString('ru-RU', { 
            year: 'numeric', month: 'long', day: 'numeric' 
        });
        const sn = user.username.replace(/'/g, "\\'");
        let mb = ''; 
        if (String(userId) !== String(currentUser.id)) 
            mb = `<button class="btn-msg" onclick="msgFromProfile('${userId}','${sn}')">Написать</button>`;
        
        const av = user.avatarUrl ? 
            `<div class="profile-avatar-wrapper"><img src="${user.avatarUrl}" alt="Аватар" loading="lazy"></div>` : 
            `<div class="profile-avatar-placeholder">${user.username.charAt(0).toUpperCase()}</div>`;
        const cover = user.coverUrl ? 
            `<div class="profile-cover"><img src="${user.coverUrl}" alt="Обложка" loading="lazy"></div>` : 
            '<div class="profile-cover"></div>';
        
        profilePage.innerHTML = `
            <div class="profile-card">
                ${cover}
                <div class="profile-avatar-section">${av}</div>
                <div class="profile-name">${esc(user.username)}${onlineDot(user.online)}</div>
                ${user.bio ? `<div class="profile-bio">${esc(user.bio)}</div>` : ''}
                <div class="profile-date">На сайте с ${jd}</div>
                <div class="profile-stats">
                    <div><div class="stat-num">${user.totalPosts}</div><div class="stat-label">постов</div></div>
                    <div><div class="stat-num">${user.streak}🔥</div><div class="stat-label">дней</div></div>
                </div>
                <div class="profile-btns">
                    ${mb}
                    <button class="btn-back-profile" onclick="goToFeed()">← Назад</button>
                </div>
            </div>`;
        
        const posts = await apiCall('/api/user/' + userId + '/posts', 'GET');
        const pc = document.createElement('div'); 
        pc.className = 'profile-posts';
        
        if (!posts || !posts.length) { 
            pc.innerHTML = '<div class="empty-feed"><h3>Нет постов</h3></div>'; 
        } else {
            const ids = posts.map(p => p.id); 
            const likesData = await apiCall('/api/likes', 'POST', { postIds: ids });
            posts.forEach(post => {
                const div = document.createElement('div'); 
                div.className = 'post-card';
                const ts = new Date(post.time).toLocaleString('ru-RU', { 
                    hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' 
                });
                const li = likesData[post.id] || { count: 0, liked: false };
                const del = (currentUser && String(post.userId) === String(currentUser.id)) ? 
                    `<button class="post-delete-btn"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6h14M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
                
                div.innerHTML = `
                    <div class="post-body">
                        <div class="post-text">${esc(post.content)}</div>
                        ${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}
                        <div class="post-time">${ts}</div>
                    </div>
                    <div class="post-footer" style="display:flex;align-items:center;justify-content:space-between;">
                        <button class="like-btn ${li.liked ? 'liked' : ''}">
                            <span class="like-icon">${li.liked ? '❤️' : '🤍'}</span>
                            <span class="like-count">${li.count > 0 ? li.count : ''}</span>
                        </button>
                        ${del}
                    </div>`;
                
                div.querySelector('.like-btn').addEventListener('click', async function() { 
                    try { 
                        const r = await apiCall('/api/like', 'POST', { postId: post.id }); 
                        const ic = this.querySelector('.like-icon'); 
                        const ct = this.querySelector('.like-count'); 
                        if (r.liked) { 
                            this.classList.add('liked', 'just-liked'); 
                            ic.textContent = '❤️'; 
                            setTimeout(() => this.classList.remove('just-liked'), 400); 
                        } else { 
                            this.classList.remove('liked'); 
                            ic.textContent = '🤍'; 
                        } 
                        ct.textContent = r.count > 0 ? r.count : ''; 
                    } catch (err) {} 
                });
                
                const db = div.querySelector('.post-delete-btn'); 
                if (db) db.addEventListener('click', async () => { 
                    if (confirm('Удалить?')) { 
                        try { 
                            await apiCall('/api/post/' + post.id, 'DELETE'); 
                            viewProfile(userId); 
                        } catch (err) { 
                            alert(err.message); 
                        } 
                    } 
                });
                
                pc.appendChild(div);
            });
        }
        profilePage.appendChild(pc);
    } catch (err) { 
        profilePage.innerHTML = '<div class="empty-feed"><h3>Пользователь не найден</h3></div>'; 
    }
}

function msgFromProfile(uid, un) { 
    sidebarBtns.forEach(b => b.classList.remove('active')); 
    document.querySelector('[data-page="messages"]').classList.add('active'); 
    feedPageEl.classList.add('hidden'); 
    profilePage.classList.add('hidden'); 
    settingsPage.classList.add('hidden'); 
    messagesPage.classList.remove('hidden'); 
    openChat(uid, un); 
    loadDialogs(); 
    if (innerWidth <= 768) { 
        dialogsSidebar.classList.add('chat-open'); 
        messagesLayout.classList.add('mobile-view'); 
    } 
}

function goToFeed() { 
    history.pushState({ page: 'feed' }, '', '/'); 
    navigateFromURL('feed'); 
}

// ===== НАСТРОЙКИ =====
async function loadSettings() {
    try {
        const d = await apiCall('/api/settings', 'GET');
        settingsUsername.value = d.username;
        settingsBio.value = d.bio || '';
        updateSA(d.avatarUrl, d.username);
        updateCoverPreview(d.coverUrl || '');
    } catch (err) {}
}

function updateSA(url, name) { 
    if (url) settingsAvatarContainer.innerHTML = `<img src="${url}" class="settings-avatar-img" alt="Аватар">`; 
    else settingsAvatarContainer.innerHTML = `<div class="settings-avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`; 
}

function updateCoverPreview(url) {
    const el = document.getElementById('settingsCoverPreview');
    if (url) el.innerHTML = `<img src="${url}" alt="Обложка">`;
    else el.innerHTML = '';
}

avatarInput.addEventListener('change', async () => { 
    const f = avatarInput.files[0]; 
    if (!f) return; 
    const fd = new FormData(); 
    fd.append('avatar', f); 
    try { 
        const r = await fetch('/api/settings', { 
            method: 'POST', 
            headers: { 'Authorization': 'Bearer ' + token }, 
            body: fd 
        }); 
        const d = await r.json(); 
        if (!r.ok) throw new Error(d.error); 
        currentUser.avatarUrl = d.avatarUrl; 
        updateSA(d.avatarUrl, currentUser.username); 
        updateAllUI(); 
        showOk('Аватар обновлён!'); 
    } catch (err) { 
        alert(err.message); 
    } 
});

coverInput?.addEventListener('change', async () => {
    const f = coverInput.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('cover', f);
    try {
        const r = await fetch('/api/settings', { 
            method: 'POST', 
            headers: { 'Authorization': 'Bearer ' + token }, 
            body: fd 
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        updateCoverPreview(d.coverUrl);
        showOk('Обложка обновлена!');
    } catch (err) { 
        alert(err.message); 
    }
});

saveProfile.addEventListener('click', async () => {
    const u = settingsUsername.value.trim();
    const b = settingsBio.value.trim();
    const p = settingsPassword.value.trim();
    
    if (!/^[a-zA-Z0-9_]+$/.test(u)) return alert('OneID: только английские буквы, цифры и _');
    if (u.length < 3) return alert('OneID от 3 символов');
    
    try {
        const body = { username: u, bio: b };
        if (p) {
            if (p.length < 4) return alert('Пароль от 4 символов');
            body.password = p;
        }
        const d = await apiCall('/api/settings', 'POST', body);
        currentUser = d.user; 
        currentUser.id = String(currentUser.id);
        updateAllUI(); 
        showOk('Сохранено!');
        if (p) settingsPassword.value = '';
    } catch (err) { 
        alert(err.message); 
    }
});

function showOk(m) { 
    settingsSuccess.textContent = '✅ ' + m; 
    settingsSuccess.classList.remove('hidden'); 
    setTimeout(() => settingsSuccess.classList.add('hidden'), 3000); 
}

// ===== СООБЩЕНИЯ =====
async function updateUnreadBadge() {
    try {
        const d = await apiCall('/api/unread', 'GET');
        msgBadge.classList.toggle('hidden', !d.count);
        if (d.count) msgBadge.textContent = d.count;
        
        if (d.count > 0) {
            const msgs = await apiCall('/api/unread-messages', 'GET');
            const newMsgs = msgs.filter(m => !notifiedMsgIds.has(m.id));
            for (const m of newMsgs) {
                notifiedMsgIds.add(m.id);
                showNotification(
                    m.fromUsername || 'Сообщение',
                    (m.text || '📷 Фото').substring(0, 100),
                    'message'
                );
            }
        }
    } catch (err) {}
}

async function loadDialogs() { 
    try { 
        const dialogs = await apiCall('/api/dialogs', 'GET'); 
        dialogsList.innerHTML = ''; 
        if (!dialogs.length) { 
            dialogsList.innerHTML = '<div class="no-dialogs">Нет диалогов</div>'; 
        } 
        dialogs.forEach(d => { 
            const div = document.createElement('div'); 
            div.className = 'dialog-item'; 
            if (String(currentChatPartner) === String(d.userId)) div.classList.add('active'); 
            const t = d.lastTime ? new Date(d.lastTime).toLocaleTimeString('ru-RU', { 
                hour: '2-digit', minute: '2-digit' 
            }) : ''; 
            div.innerHTML = `
                <div class="dialog-avatar">${d.avatarUrl ? 
                    `<img src="${d.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" loading="lazy">` : 
                    d.username.charAt(0).toUpperCase()}
                </div>
                <div class="dialog-info">
                    <div class="dialog-name">${esc(d.username)}${onlineDot(d.online)}</div>
                    <div class="dialog-last">${esc((d.lastMessage || '').substring(0, 30))}</div>
                </div>
                <div class="dialog-meta">
                    <div class="dialog-time">${t}</div>
                    ${d.unread > 0 ? `<div class="unread-badge">${d.unread}</div>` : ''}
                </div>`; 
            div.addEventListener('click', () => openChat(d.userId, d.username, d.avatarUrl)); 
            dialogsList.appendChild(div); 
        }); 
    } catch (err) {} 
}

let st; 
searchUserInput.addEventListener('input', () => { 
    clearTimeout(st); 
    const q = searchUserInput.value.trim(); 
    if (!q) { 
        searchResults.classList.add('hidden'); 
        return; 
    } 
    st = setTimeout(async () => { 
        try { 
            const users = await apiCall('/api/users/search?q=' + encodeURIComponent(q), 'GET'); 
            searchResults.classList.remove('hidden'); 
            searchResults.innerHTML = ''; 
            if (!users.length) 
                searchResults.innerHTML = '<div class="search-result-item" style="color:var(--text-secondary);">Никого нет</div>'; 
            users.forEach(u => { 
                const div = document.createElement('div'); 
                div.className = 'search-result-item'; 
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.gap = '10px';
                div.style.padding = '12px 14px';
                const av = u.avatarUrl ? 
                    `<img src="${u.avatarUrl}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;">` : 
                    `<div style="width:36px;height:36px;border-radius:50%;background:var(--avatar-gradient);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0;">${u.username.charAt(0).toUpperCase()}</div>`; 
                div.innerHTML = av + '<span style="font-size:14px;font-weight:600;">' + esc(u.username) + '</span>'; 
                div.addEventListener('click', () => { 
                    openChat(u.id, u.username, u.avatarUrl); 
                    searchUserInput.value = ''; 
                    searchResults.classList.add('hidden'); 
                }); 
                searchResults.appendChild(div); 
            }); 
        } catch (err) {} 
    }, 300); 
});

// ===== ОТКРЫТИЕ ЧАТА =====
function openChat(uid, un, avUrl) {
    document.querySelectorAll('audio').forEach(a => {
        a.pause();
        a.src = '';
        a.remove();
    });
    
    currentChatPartner = String(uid);
    lastMessagesHash = '';
    messagesHasMore = true;
    messagesLoading = false;
    
    const av = avUrl ? 
        `<img src="${avUrl}" class="chat-partner-avatar-img" alt="" loading="lazy">` : 
        `<div class="chat-partner-avatar-placeholder">${un.charAt(0).toUpperCase()}</div>`;
    
    apiCall('/api/user/' + uid, 'GET').then(user => {
        const dot = onlineDot(user.online);
        chatPartnerText.innerHTML = `
            <span class="chat-partner-info" data-userid="${uid}" style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                ${av}<span>${esc(un)}${dot}</span>
            </span>`;
        chatPartnerText.querySelector('.chat-partner-info')?.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            viewProfile(uid); 
        });
    }).catch(() => {
        chatPartnerText.innerHTML = `
            <span class="chat-partner-info" data-userid="${uid}" style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                ${av}<span>${esc(un)}</span>
            </span>`;
        chatPartnerText.querySelector('.chat-partner-info')?.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            viewProfile(uid); 
        });
    });
    
    messageInput.disabled = false;
    if (!chatPhoto && !messageInput.value.trim()) sendMessageBtn.disabled = true;
    if (chatCloseBtn) chatCloseBtn.style.display = 'flex';
    
    loadMessages(); 
    loadDialogs();
    
    if (innerWidth <= 768) { 
        dialogsSidebar.classList.add('chat-open'); 
        messagesLayout.classList.add('mobile-view'); 
    }
}

function closeChat() {
    document.querySelectorAll('audio').forEach(a => {
        a.pause();
        a.src = '';
    });
    
    dialogsSidebar.classList.remove('chat-open');
    messagesLayout.classList.remove('mobile-view');
    currentChatPartner = null;
    lastMessagesHash = '';
    chatPartnerText.textContent = 'Выберите диалог';
    messageInput.disabled = true;
    sendMessageBtn.disabled = true;
    chatMessages.innerHTML = '<div class="chat-empty">Выберите диалог или найдите пользователя</div>';
    if (chatCloseBtn) chatCloseBtn.style.display = 'none';
    
    if (typingIndicatorEl) {
        typingIndicatorEl.remove();
        typingIndicatorEl = null;
    }
}

chatBackBtn.addEventListener('click', closeChat);
chatCloseBtn?.addEventListener('click', closeChat);

messageInput.addEventListener('input', () => { 
    sendMessageBtn.disabled = !(messageInput.value.trim() || chatPhoto); 
});

// ===== ЗАГРУЗКА СООБЩЕНИЙ =====
async function loadMessages(before = null, prepend = false) {
    if (!currentChatPartner) return;
    if (messagesLoading) return;
    messagesLoading = true;
    
    let url = '/api/messages/' + currentChatPartner;
    if (before) url += '?before=' + encodeURIComponent(before);
    
    try {
        const data = await apiCall(url);
        const msgs = data.messages;
        messagesHasMore = data.hasMore;
        
        if (!prepend) {
            const hash = JSON.stringify(msgs);
            if (hash === lastMessagesHash) { 
                messagesLoading = false; 
                return; 
            }
            lastMessagesHash = hash;
            chatMessages.innerHTML = msgs.length ? '' : '<div class="chat-empty">Напишите первым!</div>';
        }
        
        const frag = document.createDocumentFragment();
        msgs.forEach(m => {
            const div = document.createElement('div');
            div.className = 'message ' + (String(m.from) === String(currentUser.id) ? 
                'message-sent' : 'message-received');
            div.dataset.msgTime = m.time;
            div.dataset.msgid = m.id;
            const t = new Date(m.time).toLocaleTimeString('ru-RU', { 
                hour: '2-digit', minute: '2-digit' 
            });
            
            let inner = '';
            if (m.replyTo) {
                const replyText = m.replyToText || 'Сообщение';
                inner += `<div class="message-reply" data-msgid="${m.replyTo}">↩ ${esc(replyText.substring(0, 50))}</div>`;
            }
            
            if (m.audioUrl) {
                inner += createAudioPlayerHTML(m.audioUrl, m.duration || 0);
            } else {
                inner += (m.text ? esc(m.text) : '');
                if (m.imageUrl) {
                    inner += `<img src="${m.imageUrl}" class="message-image" alt="Фото" loading="lazy">`;
                }
            }
            
            let checkmark = '';
            if (String(m.from) === String(currentUser.id)) {
                checkmark = m.read ? 
                    '<span style="color:#4F6EF7;font-size:11px;margin-left:4px;" title="Прочитано">✓✓</span>' : 
                    '<span style="color:#9CA3AF;font-size:11px;margin-left:4px;" title="Доставлено">✓</span>';
            }
            inner += `<div class="message-time">${t}${checkmark}</div>`;
            div.innerHTML = inner;
            
            if (m.audioUrl) {
                const playBtn = div.querySelector('.audio-play-btn');
                const progressBar = div.querySelector('.audio-progress-bar');
                const timeDisplay = div.querySelector('.audio-time');
                if (playBtn && progressBar && timeDisplay) {
                    initAudioPlayer(playBtn, progressBar, timeDisplay, m.audioUrl, m.duration || 0);
                }
            }
            
            div.querySelector('.message-reply')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const msgId = e.currentTarget.dataset.msgid;
                const target = document.querySelector(`.message[data-msgid="${msgId}"]`);
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            
            div.addEventListener('dblclick', (e) => {
                e.preventDefault();
                setReplyTo(m);
            });
            
            let longPressTimer;
            div.addEventListener('touchstart', (e) => {
                longPressTimer = setTimeout(() => setReplyTo(m), 500);
            });
            div.addEventListener('touchend', () => clearTimeout(longPressTimer));
            div.addEventListener('touchmove', () => clearTimeout(longPressTimer));
            
            frag.appendChild(div);
        });
        
        if (prepend) { 
            const oh = chatMessages.scrollHeight; 
            chatMessages.insertBefore(frag, chatMessages.firstChild); 
            chatMessages.scrollTop = chatMessages.scrollHeight - oh; 
        } else { 
            chatMessages.appendChild(frag); 
            chatMessages.scrollTop = chatMessages.scrollHeight; 
        }
    } catch (err) {}
    messagesLoading = false;
}

function setReplyTo(m) {
    replyTo = m.id;
    const previewText = m.text || (m.audioUrl ? '🎤 Голосовое' : '📷 Фото');
    replyPreviewText.textContent = previewText.substring(0, 100);
    replyPreview.classList.remove('hidden');
    messageInput.focus();
}

chatMessages.addEventListener('scroll', () => { 
    if (chatMessages.scrollTop < 100 && messagesHasMore && !messagesLoading) { 
        const fm = chatMessages.querySelector('.message'); 
        if (fm && fm.dataset.msgTime) loadMessages(fm.dataset.msgTime, true); 
    } 
});

// ===== ОТПРАВКА СООБЩЕНИЙ =====
async function sendMsg() {
    const t = messageInput.value.trim();
    if ((!t && !chatPhoto) || !currentChatPartner) return;
    
    clearTimeout(typingTimer);
    sendTypingWithRetry(false);
    
    try {
        if (chatPhoto) {
            const fd = new FormData();
            fd.append('to', currentChatPartner);
            fd.append('text', t || '');
            fd.append('image', chatPhoto);
            if (replyTo) { 
                fd.append('replyTo', replyTo); 
                fd.append('replyToText', replyPreviewText.textContent); 
            }
            await apiCall('/api/messages/photo', 'POST', fd);
        } else {
            if (wsConnected) {
                ws.send(JSON.stringify({
                    type: 'message',
                    payload: {
                        to: currentChatPartner,
                        text: t,
                        replyTo: replyTo,
                        replyToText: replyTo ? replyPreviewText.textContent : null
                    }
                }));
            } else {
                const body = { to: currentChatPartner, text: t };
                if (replyTo) { 
                    body.replyTo = replyTo; 
                    body.replyToText = replyPreviewText.textContent; 
                }
                await apiCall('/api/messages', 'POST', body);
            }
        }
        
        messageInput.value = '';
        chatPhoto = null;
        chatPhotoInput.value = '';
        chatPhotoPreview.classList.add('hidden');
        replyTo = null;
        replyPreview.classList.add('hidden');
        lastMessagesHash = '';
        loadMessages();
        loadDialogs();
    } catch (err) { 
        alert(err.message); 
    }
}

sendMessageBtn.addEventListener('click', sendMsg);
messageInput.addEventListener('keypress', (e) => { 
    if (e.key === 'Enter' && !e.shiftKey) { 
        e.preventDefault(); 
        sendMsg(); 
    } 
});

chatAttachBtn.addEventListener('click', () => { chatPhotoInput.click(); });
chatPhotoInput.addEventListener('change', () => { 
    const f = chatPhotoInput.files[0]; 
    if (!f) return; 
    chatPhoto = f; 
    const r = new FileReader(); 
    r.onload = (e) => { 
        chatPhotoPreviewImg.src = e.target.result; 
        chatPhotoPreview.classList.remove('hidden'); 
        sendMessageBtn.disabled = false; 
    }; 
    r.readAsDataURL(f); 
});
chatRemovePhoto.addEventListener('click', () => { 
    chatPhoto = null; 
    chatPhotoInput.value = ''; 
    chatPhotoPreview.classList.add('hidden'); 
    sendMessageBtn.disabled = !messageInput.value.trim(); 
});
replyPreviewClose.addEventListener('click', () => { 
    replyTo = null; 
    replyPreview.classList.add('hidden'); 
});

setInterval(() => { 
    if (currentChatPartner && !messagesPage.classList.contains('hidden') && 
        chatMessages.scrollTop > chatMessages.scrollHeight - chatMessages.clientHeight - 200) 
        loadMessages(); 
}, 3000);

setInterval(() => { 
    if (!messagesPage.classList.contains('hidden')) loadDialogs(); 
}, 5000);

function esc(s) { 
    const d = document.createElement('div'); 
    d.textContent = s; 
    return d.innerHTML; 
}

// ===== УВЕДОМЛЕНИЯ =====
function showNotification(title, text, type = 'system') {
    let container = document.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
    }
    
    const icons = { like: '❤️', message: '💬', system: '✅' };
    
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.innerHTML = `
        <div class="notif-icon ${type}">${icons[type] || '🔔'}</div>
        <div class="notif-body">
            <div class="notif-title">${esc(title)}</div>
            <div class="notif-text">${esc(text)}</div>
        </div>
        <button class="notif-close">✕</button>`;
    
    notif.querySelector('.notif-close').addEventListener('click', () => {
        notif.classList.add('removing');
        setTimeout(() => notif.remove(), 300);
    });
    
    container.appendChild(notif);
    
    setTimeout(() => {
        if (notif.parentNode) {
            notif.classList.add('removing');
            setTimeout(() => notif.remove(), 300);
        }
    }, 5000);
    
    const all = container.querySelectorAll('.notification');
    if (all.length > 3) {
        all[0].classList.add('removing');
        setTimeout(() => all[0].remove(), 300);
    }
}

// ===== НАВИГАЦИЯ =====
function navigateFromURL(page) {
    sidebarBtns.forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`[data-page="${page}"]`);
    if (btn) btn.classList.add('active');
    
    feedPageEl.classList.add('hidden');
    profilePage.classList.add('hidden');
    messagesPage.classList.add('hidden');
    settingsPage.classList.add('hidden');
    
    if (page === 'feed') { 
        feedPageEl.classList.remove('hidden'); 
        loadFeed(); 
    } else if (page === 'messages') { 
        messagesPage.classList.remove('hidden'); 
        loadDialogs(); 
    } else if (page === 'settings') { 
        settingsPage.classList.remove('hidden'); 
        loadSettings(); 
    }
    
    dialogsSidebar.classList.remove('chat-open');
    messagesLayout.classList.remove('mobile-view');
}

window.addEventListener('popstate', () => {
    const path = location.pathname.replace('/', '') || 'feed';
    navigateFromURL(path);
});

// ===== WEBSOCKET КЛИЕНТ =====
function connectWebSocket() {
    if (!token || !currentUser) return;
    
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;
        
        console.log('🔌 Подключение к WebSocket');
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('✅ WebSocket подключен');
            wsConnected = true;
            
            ws.send(JSON.stringify({
                type: 'auth',
                payload: { userId: currentUser?.id, token }
            }));
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            } catch (err) {
                console.error('❌ Ошибка парсинга WS:', err);
            }
        };
        
        ws.onclose = () => {
            console.log('❌ WebSocket отключен');
            wsConnected = false;
            
            clearTimeout(wsReconnectTimer);
            wsReconnectTimer = setTimeout(() => {
                if (token && currentUser) connectWebSocket();
            }, 5000);
        };
        
        ws.onerror = (err) => {
            console.error('❌ WebSocket ошибка:', err);
            ws.close();
        };
        
    } catch (err) {
        console.error('❌ Ошибка подключения WS:', err);
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(() => {
            if (token && currentUser) connectWebSocket();
        }, 10000);
    }
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'auth_success':
            console.log('✅ WS авторизован');
            break;
            
        case 'new_message': {
            const msg = data.payload;
            if (currentChatPartner && String(msg.from) === String(currentChatPartner)) {
                addMessageToChat(msg);
                setTimeout(() => {
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }, 100);
            }
            loadDialogs();
            updateUnreadBadge();
            break;
        }
            
        case 'online_status': {
            const { userId, online } = data.payload;
            updateOnlineStatusUI(userId, online);
            break;
        }
            
        case 'typing': {
            const { from, isTyping } = data.payload;
            showTypingIndicator(from, isTyping);
            break;
        }
            
        case 'message_sent':
            console.log('✅ Сообщение отправлено');
            break;
            
        case 'pong':
            break;
            
        case 'error':
            console.error('❌ WS ошибка:', data.payload);
            break;
    }
}

function addMessageToChat(msg) {
    const div = document.createElement('div');
    div.className = 'message ' + (String(msg.from) === String(currentUser.id) ? 
        'message-sent' : 'message-received');
    div.dataset.msgTime = msg.time;
    div.dataset.msgid = msg.id;
    
    const t = new Date(msg.time).toLocaleTimeString('ru-RU', { 
        hour: '2-digit', minute: '2-digit' 
    });
    
    let inner = '';
    if (msg.replyTo) {
        const replyText = msg.replyToText || 'Сообщение';
        inner += `<div class="message-reply" data-msgid="${msg.replyTo}">↩ ${esc(replyText.substring(0, 50))}</div>`;
    }
    
    if (msg.audioUrl) {
        inner += createAudioPlayerHTML(msg.audioUrl, msg.duration || 0);
    } else {
        inner += (msg.text ? esc(msg.text) : '');
        if (msg.imageUrl) {
            inner += `<img src="${msg.imageUrl}" class="message-image" alt="Фото" loading="lazy">`;
        }
    }
    
    let checkmark = '';
    if (String(msg.from) === String(currentUser.id)) {
        checkmark = msg.read ? 
            '<span style="color:#4F6EF7;font-size:11px;margin-left:4px;">✓✓</span>' : 
            '<span style="color:#9CA3AF;font-size:11px;margin-left:4px;">✓</span>';
    }
    inner += `<div class="message-time">${t}${checkmark}</div>`;
    div.innerHTML = inner;
    
    if (msg.audioUrl) {
        const playBtn = div.querySelector('.audio-play-btn');
        const progressBar = div.querySelector('.audio-progress-bar');
        const timeDisplay = div.querySelector('.audio-time');
        if (playBtn && progressBar && timeDisplay) {
            initAudioPlayer(playBtn, progressBar, timeDisplay, msg.audioUrl, msg.duration || 0);
        }
    }
    
    div.querySelector('.message-reply')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const msgId = e.currentTarget.dataset.msgid;
        const target = document.querySelector(`.message[data-msgid="${msgId}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    
    chatMessages.appendChild(div);
}

function showTypingIndicator(from, isTyping) {
    if (!currentChatPartner || String(currentChatPartner) !== String(from)) return;
    
    const chatMessagesEl = document.getElementById('chatMessages');
    if (!chatMessagesEl) return;
    
    if (isTyping) {
        if (!typingIndicatorEl) {
            typingIndicatorEl = document.createElement('div');
            typingIndicatorEl.id = 'typingIndicator';
            typingIndicatorEl.className = 'typing-indicator';
            typingIndicatorEl.innerHTML = 'печатает<span class="typing-dots"><span></span><span></span><span></span></span>';
            chatMessagesEl.appendChild(typingIndicatorEl);
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        }
    } else {
        if (typingIndicatorEl) {
            typingIndicatorEl.remove();
            typingIndicatorEl = null;
        }
    }
}

function updateOnlineStatusUI(userId, online) {
    if (currentChatPartner && String(currentChatPartner) === String(userId)) {
        const partnerInfo = document.querySelector('.chat-partner-info');
        if (partnerInfo) {
            const dot = online ? '<span style="display:inline-block;width:10px;height:10px;background:#10B981;border-radius:50%;margin-left:6px;" title="Онлайн"></span>' : '';
            const nameEl = partnerInfo.querySelector('span');
            if (nameEl) {
                const name = nameEl.textContent.replace(/<[^>]*>.*?<\/span>/, '').trim();
                nameEl.innerHTML = name + dot;
            }
        }
    }
}

// ===== TYPING =====
function sendTypingWithRetry(isTyping, retries = 0) {
    if (!wsConnected || !currentChatPartner) return;
    
    try {
        ws.send(JSON.stringify({
            type: 'typing',
            payload: { to: currentChatPartner, isTyping }
        }));
    } catch (err) {
        if (retries < 3) {
            setTimeout(() => sendTypingWithRetry(isTyping, retries + 1), 200);
        }
    }
}

// ===== АУДИО ПЛЕЕР =====
function createAudioPlayerHTML(audioUrl, duration) {
    return `
        <div class="audio-message">
            <button class="audio-play-btn" data-playing="false">▶</button>
            <div class="audio-progress">
                <div class="audio-progress-bar" style="width:0%"></div>
            </div>
            <span class="audio-time">${formatDuration(duration)}</span>
        </div>`;
}

function initAudioPlayer(playBtn, progressBar, timeDisplay, audioUrl, duration) {
    let audio = null;
    let isPlaying = false;
    
    playBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        
        if (!audio) {
            audio = new Audio(audioUrl);
            audio.addEventListener('ended', () => stopPlayback());
            audio.addEventListener('timeupdate', () => {
                if (audio.duration) {
                    const percent = (audio.currentTime / audio.duration) * 100;
                    progressBar.style.width = Math.min(percent, 100) + '%';
                    const remaining = Math.max(0, audio.duration - audio.currentTime);
                    timeDisplay.textContent = formatDuration(Math.round(remaining));
                }
            });
            audio.addEventListener('error', () => stopPlayback());
        }
        
        if (isPlaying) {
            stopPlayback();
        } else {
            startPlayback();
        }
    });
    
    function startPlayback() {
        if (!audio) return;
        audio.play().catch(err => console.error('❌ Ошибка воспроизведения:', err));
        isPlaying = true;
        playBtn.textContent = '⏸';
        playBtn.dataset.playing = 'true';
    }
    
    function stopPlayback() {
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
        isPlaying = false;
        playBtn.textContent = '▶';
        playBtn.dataset.playing = 'false';
        progressBar.style.width = '0%';
        timeDisplay.textContent = formatDuration(duration || 0);
    }
}

function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins + ':' + String(secs).padStart(2, '0');
}

// ===== ГОЛОСОВЫЕ СООБЩЕНИЯ =====
function setupVoiceButton() {
    voiceBtn = document.getElementById('micBtn');
    if (!voiceBtn) {
        console.error('❌ Кнопка микрофона не найдена');
        return;
    }
    
    console.log('✅ Кнопка микрофона инициализирована');
    
    voiceBtn.addEventListener('click', handleVoiceClick);
    voiceBtn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        handleVoiceClick.call(this, e);
    });
}

function handleVoiceClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (isRecording) {
        stopRecording();
        return;
    }
    startRecording();
}

function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Ваш браузер не поддерживает запись голоса');
        return;
    }
    
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(function(stream) {
            audioChunks = [];
            isRecording = true;
            
            if (voiceBtn) {
                voiceBtn.classList.add('recording');
            }
            
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 
                'audio/webm' : 'audio/mp4';
            mediaRecorder = new MediaRecorder(stream, { mimeType });
            
            mediaRecorder.ondataavailable = function(event) {
                if (event.data.size > 0) audioChunks.push(event.data);
            };
            
            mediaRecorder.onstop = function() {
                const blob = new Blob(audioChunks, { type: mimeType });
                
                if (voiceBtn) {
                    voiceBtn.classList.remove('recording');
                }
                isRecording = false;
                
                if (blob.size > 2000) {
                    sendVoiceMessage(blob);
                } else if (blob.size > 0) {
                    alert('Запись слишком короткая');
                }
                
                stream.getTracks().forEach(track => track.stop());
                mediaRecorder = null;
            };
            
            mediaRecorder.start(1000);
            
            setTimeout(function() {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                }
            }, 60000);
        })
        .catch(function(err) {
            console.error('❌ Ошибка доступа к микрофону:', err);
            alert('Нет доступа к микрофону');
        });
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    } else {
        isRecording = false;
        if (voiceBtn) {
            voiceBtn.classList.remove('recording');
        }
    }
}

async function sendVoiceMessage(blob) {
    let to = currentChatPartner;
    if (!to) {
        alert('❌ Откройте чат с собеседником');
        return;
    }
    
    const formData = new FormData();
    formData.append('to', to);
    formData.append('duration', Math.round(blob.size / 16000) || 1);
    formData.append('audio', blob, 'voice.webm');
    
    if (voiceBtn) {
        voiceBtn.textContent = '⏳';
        voiceBtn.style.background = '#F59E0B';
        voiceBtn.style.color = 'white';
    }
    
    try {
        const r = await fetch('/api/messages/audio', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token
            },
            body: formData
        });
        
        const contentType = r.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await r.text();
            console.error('❌ Сервер вернул не JSON:', text.substring(0, 200));
            throw new Error('Ошибка сервера');
        }
        
        const data = await r.json();
        
        if (!r.ok) {
            throw new Error(data.error || 'Ошибка отправки');
        }
        
        console.log('✅ Голосовое отправлено!');
        
        lastMessagesHash = '';
        loadMessages();
        loadDialogs();
        
    } catch (err) {
        console.error('❌ Ошибка отправки голосового:', err);
        alert('❌ ' + err.message);
    } finally {
        if (voiceBtn && !isRecording) {
            voiceBtn.textContent = '🎙';
            voiceBtn.style.background = '';
            voiceBtn.style.color = '';
        }
    }
}

// ===== ИНИЦИАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', function() {
    setupVoiceButton();
});

// ===== АВТОЗАПУСК =====
(function() {
    const t = localStorage.getItem('token');
    if (t) {
        token = t;
        apiCall('/api/me', 'GET')
            .then(d => {
                if (!d || !d.user) {
                    throw new Error('Некорректный ответ');
                }
                currentUser = d.user;
                currentUser.id = String(currentUser.id);
                canPostToday = d.canPost;
                
                authBlock.classList.add('hidden');
                appBlock.classList.remove('hidden');
                
                updateAllUI();
                updateCreatePostUI();
                loadFeed();
                startApp();
                
                const path = location.pathname.replace('/', '') || 'feed';
                if (path === 'feed' || path === 'messages' || path === 'settings') {
                    setTimeout(() => navigateFromURL(path), 100);
                }
            })
            .catch(err => {
                console.error('Ошибка автозапуска:', err.message);
                localStorage.removeItem('token');
                token = '';
                authBlock.classList.remove('hidden');
            });
    } else {
        authBlock.classList.remove('hidden');
    }
})();
