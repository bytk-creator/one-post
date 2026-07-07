let token = localStorage.getItem('token') || '';
let currentUser = null;
let currentChatPartner = null;
let unreadInterval = null;
let viewingUserId = null;
let canPostToday = true;
let selectedPhoto = null;
let chatPhoto = null;

const authBlock = document.getElementById('authBlock');
const appBlock = document.getElementById('appBlock');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const tabBtns = document.querySelectorAll('.tab-btn');
const logoutBtn = document.getElementById('logoutBtn');
const logoutBtnMobile = document.getElementById('logoutBtnMobile');
const msgBadge = document.getElementById('msgBadge');

const feedPage = document.getElementById('feedPage');
const profilePage = document.getElementById('profilePage');
const messagesPage = document.getElementById('messagesPage');
const settingsPage = document.getElementById('settingsPage');
const sidebarBtns = document.querySelectorAll('.sidebar-btn');

const postModal = document.getElementById('postModal');
const openPostModal = document.getElementById('openPostModal');
const closeModal = document.getElementById('closeModal');
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

const settingsUsername = document.getElementById('settingsUsername');
const settingsBio = document.getElementById('settingsBio');
const settingsPassword = document.getElementById('settingsPassword');
const settingsAvatarContainer = document.getElementById('settingsAvatarContainer');
const avatarInput = document.getElementById('avatarInput');
const settingsSuccess = document.getElementById('settingsSuccess');
const saveProfile = document.getElementById('saveProfile');
const savePassword = document.getElementById('savePassword');

const themeToggle = document.getElementById('themeToggle');

// === ТЁМНАЯ ТЕМА ===
function applyTheme(dark) {
    if (dark) {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeToggle.checked = true;
    } else {
        document.documentElement.removeAttribute('data-theme');
        themeToggle.checked = false;
    }
}

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
    applyTheme(true);
} else if (savedTheme === 'light') {
    applyTheme(false);
} else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    applyTheme(true);
} else {
    applyTheme(false);
}

themeToggle.addEventListener('change', () => {
    const isDark = themeToggle.checked;
    applyTheme(isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// === АВТОРИЗАЦИЯ ===
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loginForm.classList.toggle('hidden', btn.dataset.tab !== 'login');
        registerForm.classList.toggle('hidden', btn.dataset.tab !== 'register');
    });
});

document.getElementById('registerFormEl').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('regUsername').value.trim();
    const p = document.getElementById('regPassword').value;
    document.getElementById('registerError').textContent = '';
    try { const d = await apiCall('/api/register', 'POST', { username: u, password: p }); token = d.token; currentUser = d.user; currentUser.id = String(currentUser.id); localStorage.setItem('token', token); showApp(); } catch (err) { document.getElementById('registerError').textContent = err.message; }
});

document.getElementById('loginFormEl').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value;
    document.getElementById('loginError').textContent = '';
    try { const d = await apiCall('/api/login', 'POST', { username: u, password: p }); token = d.token; currentUser = d.user; currentUser.id = String(currentUser.id); localStorage.setItem('token', token); showApp(); } catch (err) { document.getElementById('loginError').textContent = err.message; }
});

logoutBtn.addEventListener('click', () => { token = ''; currentUser = null; localStorage.removeItem('token'); clearInterval(unreadInterval); authBlock.classList.remove('hidden'); appBlock.classList.add('hidden'); });
logoutBtnMobile.addEventListener('click', () => { token = ''; currentUser = null; localStorage.removeItem('token'); clearInterval(unreadInterval); authBlock.classList.remove('hidden'); appBlock.classList.add('hidden'); });

// === НАВИГАЦИЯ ===
sidebarBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        sidebarBtns.forEach(b => b.classList.remove('active')); btn.classList.add('active');
        feedPage.classList.add('hidden'); profilePage.classList.add('hidden'); messagesPage.classList.add('hidden'); settingsPage.classList.add('hidden');
        const page = btn.dataset.page;
        if (page === 'feed') { feedPage.classList.remove('hidden'); }
        else if (page === 'messages') { messagesPage.classList.remove('hidden'); loadDialogs(); }
        else if (page === 'settings') { settingsPage.classList.remove('hidden'); loadSettings(); }
        dialogsSidebar.classList.remove('chat-open'); messagesLayout.classList.remove('mobile-view');
    });
});

// === МОДАЛКА ===
openPostModal.addEventListener('click', () => { postModal.classList.remove('hidden'); if (canPostToday) { postTextarea.focus(); postLimitWarning.classList.add('hidden'); publishBtn.disabled = false; } else { postLimitWarning.classList.remove('hidden'); publishBtn.disabled = true; } });
closeModal.addEventListener('click', () => { postModal.classList.add('hidden'); postTextarea.value = ''; clearPhoto(); });
postModal.addEventListener('click', (e) => { if (e.target === postModal) { postModal.classList.add('hidden'); postTextarea.value = ''; clearPhoto(); } });
function clearPhoto() { selectedPhoto = null; photoInput.value = ''; photoPreview.classList.add('hidden'); photoLabel.classList.remove('has-photo'); }
photoInput.addEventListener('change', () => { const f = photoInput.files[0]; if (f) { selectedPhoto = f; const r = new FileReader(); r.onload = (e) => { photoPreviewImg.src = e.target.result; photoPreview.classList.remove('hidden'); photoLabel.classList.add('has-photo'); }; r.readAsDataURL(f); } });
removePhoto.addEventListener('click', clearPhoto);
publishBtn.addEventListener('click', async () => {
    const c = postTextarea.value.trim(); if (!c) return;
    publishBtn.disabled = true; publishBtn.textContent = 'Публикуем...';
    try {
        const fd = new FormData(); fd.append('content', c); if (selectedPhoto) fd.append('image', selectedPhoto);
        const r = await fetch('/api/post', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Ошибка');
        postTextarea.value = ''; postModal.classList.add('hidden'); clearPhoto(); canPostToday = false; updateCreatePostUI(); loadFeed();
    } catch (err) { alert(err.message); publishBtn.disabled = false; publishBtn.textContent = 'Опубликовать'; }
});

// === API ===
async function apiCall(url, method, body = null) {
    const h = {}; if (body) h['Content-Type'] = 'application/json'; if (token) h['Authorization'] = 'Bearer ' + token;
    const o = { method, headers: h }; if (body) o.body = JSON.stringify(body);
    const r = await fetch(url, o); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Ошибка'); return d;
}

// === ЗАПУСК ===
async function showApp() {
    try { const d = await apiCall('/api/me', 'GET'); currentUser = d.user; currentUser.id = String(currentUser.id); canPostToday = d.canPost; authBlock.classList.add('hidden'); appBlock.classList.remove('hidden'); updateAllUI(); updateCreatePostUI(); loadFeed(); updateUnreadBadge(); unreadInterval = setInterval(updateUnreadBadge, 5000); } catch (err) { token = ''; localStorage.removeItem('token'); authBlock.classList.remove('hidden'); appBlock.classList.add('hidden'); }
}
function updateAllUI() { const a = currentUser.avatarUrl ? `<img src="${currentUser.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : currentUser.username.charAt(0).toUpperCase(); document.getElementById('sidebarAvatar').innerHTML = a; document.getElementById('createPostAvatar').innerHTML = a; document.getElementById('sidebarUsername').textContent = currentUser.username; }
function updateCreatePostUI() { const i = document.getElementById('openPostModal'); if (canPostToday) { i.textContent = 'Что у вас нового?'; i.style.color = ''; } else { i.textContent = 'Вы уже опубликовали пост сегодня'; i.style.color = '#999'; } }

function showSkeletons() {
    feedContainer.innerHTML = '<div class="feed-title">Новости</div>' +
        '<div class="skeleton skeleton-card"></div>'.repeat(3);
}

// === ЛЕНТА ===
async function loadFeed() {
    showSkeletons();
    try {
        const posts = await apiCall('/api/posts', 'GET');
        if (!posts || !posts.length) {
            feedContainer.innerHTML = `<div class="empty-feed">
                <div class="empty-icon"><svg viewBox="0 0 80 80" width="64" height="64"><rect x="12" y="16" width="56" height="48" rx="8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><line x1="24" y1="32" x2="56" y2="32" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><line x1="24" y1="42" x2="48" y2="42" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/><line x1="24" y1="52" x2="40" y2="52" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.3"/></svg></div>
                <h3>Лента пуста</h3><p>Здесь будут посты пользователей. Станьте первым!</p></div>`;
            return;
        }
        const ids = posts.map(p => p.id); const likesData = await apiCall('/api/likes', 'POST', { postIds: ids });
        feedContainer.innerHTML = '<div class="feed-title">Новости</div>';
        posts.forEach((post, index) => {
            const div = document.createElement('div'); div.className = 'post-card';
            div.style.animationDelay = (index * 0.05) + 's';
            const ts = new Date(post.time).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
            const li = likesData[post.id] || { count: 0, liked: false };
            const av = post.authorAvatar ? `<img src="${post.authorAvatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : post.author.charAt(0).toUpperCase();
            const del = (currentUser && String(post.userId) === String(currentUser.id)) ? `<button class="post-delete-btn" data-postid="${post.id}" title="Удалить"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6h14M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
            div.innerHTML = `<div class="post-header"><div class="post-avatar" data-userid="${post.userId}">${av}</div><div class="post-author-info"><div class="post-author" data-userid="${post.userId}">${escapeHTML(post.author)}</div><div class="post-time">${ts}</div></div><div class="post-header-right">${del}</div></div><div class="post-body"><div class="post-text">${escapeHTML(post.content)}</div>${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}</div><div class="post-footer"><button class="like-btn ${li.liked ? 'liked' : ''}" data-postid="${post.id}"><span class="like-icon">${li.liked ? '❤️' : '🤍'}</span><span class="like-count">${li.count > 0 ? li.count : ''}</span></button></div>`;
            div.querySelectorAll('[data-userid]').forEach(el => el.addEventListener('click', (e) => { if (!e.target.closest('.like-btn') && !e.target.closest('.post-delete-btn')) viewProfile(post.userId); }));
            const lb = div.querySelector('.like-btn'); lb.addEventListener('click', async () => { try { const r = await apiCall('/api/like', 'POST', { postId: post.id }); const ic = lb.querySelector('.like-icon'); const ct = lb.querySelector('.like-count'); if (r.liked) { lb.classList.add('liked', 'just-liked'); ic.textContent = '❤️'; setTimeout(() => lb.classList.remove('just-liked'), 400); } else { lb.classList.remove('liked'); ic.textContent = '🤍'; } ct.textContent = r.count > 0 ? r.count : ''; } catch (err) {} });
            const db = div.querySelector('.post-delete-btn'); if (db) db.addEventListener('click', async () => { if (confirm('Удалить пост?')) { try { await apiCall('/api/post/' + post.id, 'DELETE'); loadFeed(); } catch (err) { alert(err.message); } } });
            feedContainer.appendChild(div);
        });
    } catch (err) { feedContainer.innerHTML = '<div class="empty-feed"><h3>Ошибка загрузки</h3><p>Попробуйте обновить страницу</p></div>'; }
}

// === ПРОФИЛЬ ===
async function viewProfile(userId) {
    viewingUserId = userId; sidebarBtns.forEach(b => b.classList.remove('active'));
    feedPage.classList.add('hidden'); messagesPage.classList.add('hidden'); settingsPage.classList.add('hidden'); profilePage.classList.remove('hidden');
    profilePage.innerHTML = '<div class="skeleton" style="height:200px;border-radius:16px;margin-bottom:20px;"></div>';
    try {
        const user = await apiCall('/api/user/' + userId, 'GET');
        const jd = new Date(user.createdAt).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
        const sn = user.username.replace(/'/g, "\\'");
        let mb = ''; if (String(userId) !== String(currentUser.id)) mb = `<button class="btn-msg" onclick="messageFromProfile('${userId}', '${sn}')">Написать</button>`;
        const av = user.avatarUrl ? `<div class="profile-avatar-wrapper"><img src="${user.avatarUrl}" alt="Аватар"></div>` : `<div class="profile-avatar-placeholder">${user.username.charAt(0).toUpperCase()}</div>`;
        const bio = user.bio ? `<div class="profile-bio">${escapeHTML(user.bio)}</div>` : '';
        profilePage.innerHTML = `<div class="profile-card">${av}<div class="profile-name">${escapeHTML(user.username)}</div>${bio}<div class="profile-date">На сайте с ${jd}</div><div class="profile-stats"><div><div class="stat-num">${user.totalPosts}</div><div class="stat-label">постов</div></div><div><div class="stat-num">${user.streak}🔥</div><div class="stat-label">дней подряд</div></div></div><div class="profile-btns">${mb}<button class="btn-back-profile" onclick="goToFeed()">← Назад</button></div></div>`;
        const posts = await apiCall('/api/user/' + userId + '/posts', 'GET');
        const pc = document.createElement('div'); pc.className = 'profile-posts';
        if (!posts || !posts.length) {
            pc.innerHTML = `<div class="empty-feed"><div class="empty-icon"><svg viewBox="0 0 80 80" width="48" height="48"><rect x="16" y="20" width="48" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><line x1="28" y1="34" x2="52" y2="34" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="28" y1="44" x2="44" y2="44" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div><h3>Нет постов</h3><p>Пользователь пока ничего не опубликовал</p></div>`;
        } else {
            const ids = posts.map(p => p.id); const likesData = await apiCall('/api/likes', 'POST', { postIds: ids });
            posts.forEach(post => {
                const div = document.createElement('div'); div.className = 'post-card';
                const ts = new Date(post.time).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
                const li = likesData[post.id] || { count: 0, liked: false };
                const del = (currentUser && String(post.userId) === String(currentUser.id)) ? `<button class="post-delete-btn" data-postid="${post.id}" title="Удалить"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6h14M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
                div.innerHTML = `<div class="post-body"><div class="post-text">${escapeHTML(post.content)}</div>${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}<div class="post-time">${ts}</div></div><div class="post-footer" style="display:flex;align-items:center;justify-content:space-between;"><button class="like-btn ${li.liked ? 'liked' : ''}" data-postid="${post.id}"><span class="like-icon">${li.liked ? '❤️' : '🤍'}</span><span class="like-count">${li.count > 0 ? li.count : ''}</span></button>${del}</div>`;
                const lb = div.querySelector('.like-btn'); lb.addEventListener('click', async () => { try { const r = await apiCall('/api/like', 'POST', { postId: post.id }); const ic = lb.querySelector('.like-icon'); const ct = lb.querySelector('.like-count'); if (r.liked) { lb.classList.add('liked', 'just-liked'); ic.textContent = '❤️'; setTimeout(() => lb.classList.remove('just-liked'), 400); } else { lb.classList.remove('liked'); ic.textContent = '🤍'; } ct.textContent = r.count > 0 ? r.count : ''; } catch (err) {} });
                const db = div.querySelector('.post-delete-btn'); if (db) db.addEventListener('click', async () => { if (confirm('Удалить пост?')) { try { await apiCall('/api/post/' + post.id, 'DELETE'); viewProfile(userId); } catch (err) { alert(err.message); } } });
                pc.appendChild(div);
            });
        }
        profilePage.appendChild(pc);
    } catch (err) { profilePage.innerHTML = '<div class="empty-feed"><h3>Пользователь не найден</h3></div>'; }
}

function messageFromProfile(userId, username) {
    sidebarBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('[data-page="messages"]').classList.add('active');
    feedPage.classList.add('hidden'); profilePage.classList.add('hidden'); settingsPage.classList.add('hidden'); messagesPage.classList.remove('hidden');
    openChat(userId, username); loadDialogs();
    if (window.innerWidth <= 768) { dialogsSidebar.classList.add('chat-open'); messagesLayout.classList.add('mobile-view'); }
}

function goToFeed() {
    sidebarBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('[data-page="feed"]').classList.add('active');
    feedPage.classList.remove('hidden'); profilePage.classList.add('hidden'); messagesPage.classList.add('hidden'); settingsPage.classList.add('hidden');
    dialogsSidebar.classList.remove('chat-open'); messagesLayout.classList.remove('mobile-view');
}

// === НАСТРОЙКИ ===
async function loadSettings() { try { const d = await apiCall('/api/settings', 'GET'); settingsUsername.value = d.username; settingsBio.value = d.bio || ''; updateSettingsAvatar(d.avatarUrl, d.username); } catch (err) {} }
function updateSettingsAvatar(url, name) { if (url) settingsAvatarContainer.innerHTML = `<img src="${url}" class="settings-avatar-img" alt="Аватар">`; else settingsAvatarContainer.innerHTML = `<div class="settings-avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`; }
avatarInput.addEventListener('change', async () => { const f = avatarInput.files[0]; if (!f) return; const fd = new FormData(); fd.append('avatar', f); try { const r = await fetch('/api/settings', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd }); const d = await r.json(); if (!r.ok) throw new Error(d.error); currentUser.avatarUrl = d.avatarUrl; updateSettingsAvatar(d.avatarUrl, currentUser.username); updateAllUI(); showSuccess('Аватар обновлён!'); } catch (err) { alert(err.message); } });
saveProfile.addEventListener('click', async () => { const u = settingsUsername.value.trim(); const b = settingsBio.value.trim(); if (u.length < 3) return alert('Имя минимум 3 символа'); try { const d = await apiCall('/api/settings', 'POST', { username: u, bio: b }); currentUser = d.user; currentUser.id = String(currentUser.id); updateAllUI(); showSuccess('Профиль сохранён!'); } catch (err) { alert(err.message); } });
savePassword.addEventListener('click', async () => { const p = settingsPassword.value.trim(); if (!p) return alert('Введите пароль'); if (p.length < 4) return alert('Минимум 4 символа'); try { await apiCall('/api/settings', 'POST', { password: p }); settingsPassword.value = ''; showSuccess('Пароль изменён!'); } catch (err) { alert(err.message); } });
function showSuccess(msg) { settingsSuccess.textContent = '✅ ' + msg; settingsSuccess.classList.remove('hidden'); setTimeout(() => settingsSuccess.classList.add('hidden'), 3000); }

// === СООБЩЕНИЯ ===
async function updateUnreadBadge() { try { const d = await apiCall('/api/unread', 'GET'); if (d.count > 0) { msgBadge.textContent = d.count; msgBadge.classList.remove('hidden'); } else msgBadge.classList.add('hidden'); } catch (err) {} }
async function loadDialogs() {
    try { const dialogs = await apiCall('/api/dialogs', 'GET'); dialogsList.innerHTML = ''; if (!dialogs.length) { dialogsList.innerHTML = '<div class="no-dialogs">Нет диалогов</div>'; } dialogs.forEach(d => { const div = document.createElement('div'); div.className = 'dialog-item'; if (String(currentChatPartner) === String(d.userId)) div.classList.add('active'); const t = d.lastTime ? new Date(d.lastTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''; div.innerHTML = `<div class="dialog-avatar">${d.avatarUrl ? `<img src="${d.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : d.username.charAt(0).toUpperCase()}</div><div class="dialog-info"><div class="dialog-name">${escapeHTML(d.username)}</div><div class="dialog-last">${escapeHTML((d.lastMessage || '').substring(0, 30))}</div></div><div class="dialog-meta"><div class="dialog-time">${t}</div>${d.unread > 0 ? `<div class="unread-badge">${d.unread}</div>` : ''}</div>`; div.addEventListener('click', () => openChat(d.userId, d.username, d.avatarUrl)); dialogsList.appendChild(div); }); } catch (err) {}
}
let st; searchUserInput.addEventListener('input', () => { clearTimeout(st); const q = searchUserInput.value.trim(); if (!q) { searchResults.classList.add('hidden'); return; } st = setTimeout(async () => { try { const users = await apiCall('/api/users/search?q=' + encodeURIComponent(q), 'GET'); searchResults.classList.remove('hidden'); searchResults.innerHTML = ''; if (!users.length) searchResults.innerHTML = '<div class="search-result-item" style="color:var(--text-secondary);">Никого нет</div>'; users.forEach(u => { const div = document.createElement('div'); div.className = 'search-result-item'; div.textContent = u.username; div.addEventListener('click', () => { openChat(u.id, u.username, null); searchUserInput.value = ''; searchResults.classList.add('hidden'); }); searchResults.appendChild(div); }); } catch (err) {} }, 300); });

function openChat(userId, username, avatarUrl) {
    currentChatPartner = String(userId);
    const av = avatarUrl ? `<img src="${avatarUrl}" class="chat-partner-avatar-img" alt="">` : `<div class="chat-partner-avatar-placeholder">${username.charAt(0).toUpperCase()}</div>`;
    chatPartnerText.innerHTML = `<span class="chat-partner-info" data-userid="${userId}" style="display:flex;align-items:center;gap:10px;cursor:pointer;">${av}<span>${escapeHTML(username)}</span></span>`;
    const partnerInfo = chatPartnerText.querySelector('.chat-partner-info');
    if (partnerInfo) {
        partnerInfo.addEventListener('click', (e) => { e.stopPropagation(); viewProfile(userId); });
    }
    messageInput.disabled = false;
    if (!chatPhoto) sendMessageBtn.disabled = true;
    loadMessages(); loadDialogs();
    if (window.innerWidth <= 768) { dialogsSidebar.classList.add('chat-open'); messagesLayout.classList.add('mobile-view'); }
}

chatBackBtn.addEventListener('click', () => { dialogsSidebar.classList.remove('chat-open'); messagesLayout.classList.remove('mobile-view'); currentChatPartner = null; chatPartnerText.innerHTML = 'Выберите диалог'; messageInput.disabled = true; sendMessageBtn.disabled = true; chatMessages.innerHTML = '<div class="chat-empty"><div class="empty-chat-icon">💬</div>Выберите диалог или найдите пользователя</div>'; });

messageInput.addEventListener('input', () => {
    if (messageInput.value.trim() || chatPhoto) {
        sendMessageBtn.disabled = false;
    } else {
        sendMessageBtn.disabled = true;
    }
});

async function loadMessages() { if (!currentChatPartner) { chatMessages.innerHTML = '<div class="chat-empty">Выберите диалог</div>'; return; } try { const msgs = await apiCall('/api/messages/' + currentChatPartner, 'GET'); chatMessages.innerHTML = ''; if (!msgs.length) chatMessages.innerHTML = '<div class="chat-empty"><div class="empty-chat-icon">👋</div>Напишите первым!</div>'; msgs.forEach(m => { const div = document.createElement('div'); div.className = 'message ' + (String(m.from) === String(currentUser.id) ? 'message-sent' : 'message-received'); const t = new Date(m.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); const textHtml = m.text ? escapeHTML(m.text) : ''; const imgHtml = m.imageUrl ? `<img src="${m.imageUrl}" class="message-image" alt="Фото" loading="lazy">` : ''; div.innerHTML = (textHtml ? textHtml : '') + imgHtml + '<div class="message-time">' + t + '</div>'; chatMessages.appendChild(div); }); chatMessages.scrollTop = chatMessages.scrollHeight; updateUnreadBadge(); } catch (err) {} }

async function sendMsg() {
    const t = messageInput.value.trim();
    if ((!t && !chatPhoto) || !currentChatPartner) return;
    try {
        if (chatPhoto) {
            const fd = new FormData();
            fd.append('to', currentChatPartner);
            fd.append('text', t || '');
            fd.append('image', chatPhoto);
            const r = await fetch('/api/messages/photo', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body: fd
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Ошибка');
        } else {
            await apiCall('/api/messages', 'POST', { to: currentChatPartner, text: t });
        }
        messageInput.value = '';
        chatPhoto = null;
        chatPhotoInput.value = '';
        chatPhotoPreview.classList.add('hidden');
        if (!messageInput.value.trim()) sendMessageBtn.disabled = true;
        loadMessages();
        loadDialogs();
    } catch (err) { alert(err.message); }
}

sendMessageBtn.addEventListener('click', sendMsg);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMsg(); });

// === ФОТО В ЧАТЕ ===
chatAttachBtn.addEventListener('click', () => { chatPhotoInput.click(); });
chatPhotoInput.addEventListener('change', () => {
    const f = chatPhotoInput.files[0];
    if (f) {
        chatPhoto = f;
        const reader = new FileReader();
        reader.onload = (e) => {
            chatPhotoPreviewImg.src = e.target.result;
            chatPhotoPreview.classList.remove('hidden');
            sendMessageBtn.disabled = false;
        };
        reader.readAsDataURL(f);
    }
});
chatRemovePhoto.addEventListener('click', () => {
    chatPhoto = null;
    chatPhotoInput.value = '';
    chatPhotoPreview.classList.add('hidden');
    if (!messageInput.value.trim()) sendMessageBtn.disabled = true;
});

setInterval(() => { if (currentChatPartner && !messagesPage.classList.contains('hidden')) loadMessages(); }, 3000);
setInterval(() => { if (!messagesPage.classList.contains('hidden')) loadDialogs(); }, 5000);

function escapeHTML(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
if (token) showApp();