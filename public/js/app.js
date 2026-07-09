// ========== РОУТЕР ==========

const appBlock = document.getElementById('appBlock');
const authBlock = document.getElementById('authBlock');
const contentWrapper = document.querySelector('.content-wrapper');
const sidebarBtns = document.querySelectorAll('.sidebar-btn');

// Состояние
let currentUser = null;
let currentPage = 'feed';
let unreadInterval = null;

// Страницы
const pages = {
    feed: document.getElementById('feedPage'),
    profile: document.getElementById('profilePage'),
    messages: document.getElementById('messagesPage'),
    settings: document.getElementById('settingsPage')
};

// Инициализация
(function() {
    initTheme();
    
    const t = localStorage.getItem('token');
    if (t) {
        setToken(t);
        api('/api/me', 'GET')
            .then(d => { currentUser = d.user; enterApp(); })
            .catch(() => { token = ''; localStorage.removeItem('token'); showAuth(); });
    } else {
        showAuth();
    }
})();

function showAuth() {
    authBlock.classList.remove('hidden');
    appBlock.classList.add('hidden');
}

function enterApp() {
    authBlock.classList.add('hidden');
    appBlock.classList.remove('hidden');
    
    // Обновить сайдбар
    updateSidebar();
    
    // Запустить пинг
    api('/api/ping', 'POST').catch(() => {});
    setInterval(() => { if (token) api('/api/ping', 'POST').catch(() => {}); }, 30000);
    
    // Загрузить страницу из URL или ленту
    handleRoute();
    
    // Запустить обновление непрочитанных
    if (typeof updateUnreadBadge === 'function') {
        updateUnreadBadge();
        unreadInterval = setInterval(updateUnreadBadge, 5000);
    }
}

// Навигация
sidebarBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        navigate(page);
    });
});

// Обработка кнопок назад/вперёд браузера
window.addEventListener('popstate', () => {
    handleRoute(false);
});

function navigate(page, pushState = true) {
    currentPage = page;
    
    // Обновить URL
    if (pushState) {
        history.pushState({ page }, '', page === 'feed' ? '/' : '/' + page);
    }
    
    // Обновить сайдбар
    sidebarBtns.forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`[data-page="${page}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    // Показать страницу
    Object.keys(pages).forEach(k => pages[k].classList.add('hidden'));
    if (pages[page]) pages[page].classList.remove('hidden');
    
    // Сбросить чат
    if (page !== 'messages') {
        const ds = document.getElementById('dialogsSidebar');
        const ml = document.getElementById('messagesLayout');
        if (ds) ds.classList.remove('chat-open');
        if (ml) ml.classList.remove('mobile-view');
    }
    
    // Загрузить контент
    loadPage(page);
}

function handleRoute(pushState = true) {
    const path = location.pathname.replace('/', '');
    const page = path === '' ? 'feed' : path;
    navigate(page, pushState);
}

function loadPage(page) {
    switch (page) {
        case 'feed': if (typeof loadFeed === 'function') loadFeed(); break;
        case 'profile': if (typeof loadProfile === 'function') loadProfile(); break;
        case 'messages': if (typeof loadDialogs === 'function') loadDialogs(); break;
        case 'settings': if (typeof loadSettings === 'function') loadSettings(); break;
    }
}

function updateSidebar() {
    const av = currentUser.avatarUrl 
        ? `<img src="${currentUser.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` 
        : currentUser.username.charAt(0).toUpperCase();
    document.getElementById('sidebarAvatar').innerHTML = av;
    document.getElementById('createPostAvatar').innerHTML = av;
    document.getElementById('sidebarUsername').textContent = currentUser.username;
}

// Выход
function logout() {
    localStorage.removeItem('token');
    token = '';
    setToken('');
    clearInterval(unreadInterval);
    appBlock.classList.add('hidden');
    authBlock.classList.remove('hidden');
    currentUser = null;
    history.pushState({}, '', '/');
}

document.getElementById('logoutBtnMobile')?.addEventListener('click', logout);
document.getElementById('logoutBtnDesktop')?.addEventListener('click', logout);
