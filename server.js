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

  socket.on('newTask', (task) => {
    console.log('📝 Новая задача:', task.text);
    io.emit('taskAdded', task);

    const payload = JSON.stringify({
      title: 'Новая заметка',
      body: task.text
    });

    subscriptions.forEach(sub => {
      webpush.sendNotification(sub, payload)
        .catch(err => console.error('Push error:', err));
    });
  });

  socket.on('disconnect', () => {
    console.log('❌ Клиент отключён:', socket.id);
  });
});

app.post('/subscribe', (req, res) => {
  subscriptions.push(req.body);
  console.log('🔔 Новая подписка, всего:', subscriptions.length);
  res.status(201).json({ message: 'Подписка сохранена' });
});

app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  subscriptions = subscriptions.filter(sub => sub.endpoint !== endpoint);
  console.log('🔕 Отписка, осталось:', subscriptions.length);
  res.status(200).json({ message: 'Подписка удалена' });
});

server.listen(3001, () => {
  console.log('🚀 Сервер запущен на https://localhost:3001');
});