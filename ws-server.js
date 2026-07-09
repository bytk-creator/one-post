const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

// Создаём HTTP сервер для WebSocket
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Хранилище подключений
const clients = new Map();

// Временно используем простую проверку токена
// Позже можно будет интегрировать с основной БД
function verifyToken(token) {
    // Простая проверка: токен должен быть не пустым и длинным
    if (!token || token.length < 32) return null;
    // В реальном проекте здесь будет проверка в БД
    return { id: 'temp', username: 'temp' };
}

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
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'auth') {
                const { userId: uid, token: t } = data;
                
                // Проверяем токен (здесь нужно интегрировать с БД)
                // Пока используем простую проверку
                if (!t || t.length < 32) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        payload: 'Неверный токен' 
                    }));
                    ws.close(4003, 'Неверный токен');
                    return;
                }
                
                userId = String(uid);
                
                // Сохраняем подключение
                clients.set(userId, ws);
                console.log(`✅ Пользователь ${userId} подключён`);
                
                // Подтверждаем авторизацию
                ws.send(JSON.stringify({ 
                    type: 'auth_success', 
                    payload: { userId } 
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
                
                const msgId = Date.now().toString();
                const msgData = {
                    id: msgId,
                    from: String(userId),
                    to: String(to),
                    text: text || '',
                    replyTo: replyTo || null,
                    replyToText: replyToText || null,
                    time: new Date().toISOString(),
                    read: 0
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

// Сохраняем ссылки для интеграции
module.exports = { wss, clients, broadcastOnlineStatus };

// Запуск на порту 8080
const PORT = process.env.WS_PORT || 8080;
server.listen(PORT, () => {
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
