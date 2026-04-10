const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const vapidKeys = {
  publicKey: 'BIc9NAfTlfCR4sfkddVGjVbAmeoACBfvnaM_D-en4XbgtKfxbFDV0ENPEicLTd3fYq8ZKP-U07wcGJ8_FyrwArI',
  privateKey: 'xuzS--HPL_rJbkaAtZYCM3z11aGlj8TAGtEmil8cusA'
};

webpush.setVapidDetails(
  'mailto:your@email.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, './')));

let subscriptions = [];

// Хранилище напоминаний: ключ - id, значение - { timeoutId, text, reminderTime }
const reminders = new Map();

const sslOptions = {
  cert: fs.readFileSync(path.join(__dirname, 'localhost+2.pem')),
  key: fs.readFileSync(path.join(__dirname, 'localhost+2-key.pem'))
};

const server = https.createServer(sslOptions, app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.on('connection', (socket) => {
  console.log('✅ Клиент подключён:', socket.id);

  // Обычная заметка — рассылаем всем
  socket.on('newTask', (task) => {
    console.log('📝 Новая задача:', task.text);
    io.emit('taskAdded', task);

    const payload = JSON.stringify({
      title: 'Новая заметка',
      body: task.text,
      reminderId: null
    });

    subscriptions.forEach(sub => {
      webpush.sendNotification(sub, payload)
        .catch(err => console.error('Push error:', err));
    });
  });

  // Заметка с напоминанием — планируем таймер
  socket.on('newReminder', (reminder) => {
    const { id, text, reminderTime } = reminder;
    const delay = reminderTime - Date.now();

    if (delay <= 0) {
      console.log('⚠️ Время напоминания уже прошло');
      return;
    }

    console.log(`⏰ Напоминание запланировано: "${text}" через ${Math.round(delay/1000)} сек`);

    const timeoutId = setTimeout(() => {
      const payload = JSON.stringify({
        title: '⏰ Напоминание',
        body: text,
        reminderId: id
      });

      subscriptions.forEach(sub => {
        webpush.sendNotification(sub, payload)
          .catch(err => console.error('Push error:', err));
      });

      reminders.delete(id);
      console.log(`Напоминание отправлено: "${text}"`);
    }, delay);

    reminders.set(id, { timeoutId, text, reminderTime });
  });

  socket.on('disconnect', () => {
    console.log('Клиент отключён:', socket.id);
  });
});

// Подписка на push
app.post('/subscribe', (req, res) => {
  subscriptions.push(req.body);
  console.log('Новая подписка, всего:', subscriptions.length);
  res.status(201).json({ message: 'Подписка сохранена' });
});

// Отписка от push
app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  subscriptions = subscriptions.filter(sub => sub.endpoint !== endpoint);
  console.log('Отписка, осталось:', subscriptions.length);
  res.status(200).json({ message: 'Подписка удалена' });
});

// Отложить напоминание на 5 минут
app.post('/snooze', (req, res) => {
  const reminderId = parseInt(req.query.reminderId, 10);

  if (!reminderId || !reminders.has(reminderId)) {
    return res.status(404).json({ error: 'Reminder not found' });
  }

  const reminder = reminders.get(reminderId);
  clearTimeout(reminder.timeoutId);

  const newDelay = 5 * 60 * 1000; // 5 минут

  const newTimeoutId = setTimeout(() => {
    const payload = JSON.stringify({
      title: 'Напоминание (отложено)',
      body: reminder.text,
      reminderId: reminderId
    });

    subscriptions.forEach(sub => {
      webpush.sendNotification(sub, payload)
        .catch(err => console.error('Push error:', err));
    });

    reminders.delete(reminderId);
    console.log(`Отложенное напоминание отправлено: "${reminder.text}"`);
  }, newDelay);

  reminders.set(reminderId, {
    timeoutId: newTimeoutId,
    text: reminder.text,
    reminderTime: Date.now() + newDelay
  });

  console.log(`Напоминание отложено на 5 минут: "${reminder.text}"`);
  res.status(200).json({ message: 'Reminder snoozed for 5 minutes' });
});

server.listen(3001, () => {
  console.log('Сервер запущен на https://localhost:3001');
});