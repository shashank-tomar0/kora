const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000/api/whatsapp/webhook';
const QR_FILE_PATH = path.join(__dirname, '../backend/current_qr.txt');

let activeSock = null;
let serverStarted = false;
let agendaInterval = null;
let lastAgendaSentDate = '';
let currentQr = null;

async function startSock() {
    try {
        console.log('Initializing Baileys WhatsApp Socket...');
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        // Fetch latest WhatsApp Web version
        let version = [2, 3000, 1017531287];
        try {
            const { version: latestVersion, isLatest } = await fetchLatestBaileysVersion();
            console.log(`Fetched latest WhatsApp version: ${latestVersion.join('.')}, isLatest: ${isLatest}`);
            version = latestVersion;
        } catch(err) {
            console.warn('Failed to fetch latest WhatsApp version, using default fallback:', err.message);
        }
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        version,
        printQRInTerminal: true
    });
    
    activeSock = sock;

    // Start outgoing message HTTP bridge server if not started
    if (!serverStarted) {
        const http = require('http');
        const server = http.createServer((req, res) => {
                        if (req.method === 'GET' && req.url === '/status') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    status: 'online', 
                    connected: activeSock && activeSock.user ? true : false,
                    user: activeSock ? activeSock.user : null,
                    qr: currentQr
                }));
                return;
            }
            if (req.method === 'POST' && req.url === '/send') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', async () => {
                    try {
                        const data = JSON.parse(body);
                        if (data.to && data.text) {
                            if (activeSock) {
                                await activeSock.sendMessage(data.to, { text: data.text });
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ status: 'success' }));
                            } else {
                                res.writeHead(503, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ error: 'WhatsApp socket not connected yet' }));
                            }
                        } else {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Missing to or text' }));
                        }
                    } catch (e) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        server.listen(8002, () => {
            console.log('WhatsApp send bridge server listening on port 8002');
        });
        serverStarted = true;
    }
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr) {
            console.log('\n=========================================');
            console.log('SCAN THIS QR CODE WITH WHATSAPP TO CONNECT:');
            console.log('=========================================\n');
            qrcode.generate(qr, { small: true });
            currentQr = qr;
            
            // Write QR code to a file so that backend can serve it to the mobile client
            try {
                fs.writeFileSync(QR_FILE_PATH, qr);
            } catch(err) {
                console.error('Error writing QR file:', err.message);
            }
        }
        
        if(connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            currentQr = null;
            
            // Clear morning agenda timer if disconnected
            if (agendaInterval) {
                clearInterval(agendaInterval);
                agendaInterval = null;
            }

            // Clean QR file
            try {
                if (fs.existsSync(QR_FILE_PATH)) {
                    fs.unlinkSync(QR_FILE_PATH);
                }
            } catch(e) {}
            
            if(shouldReconnect) {
                setTimeout(startSock, 5000); // Wait 5s before reconnecting
            } else {
                console.log('Logged out of WhatsApp. Clear auth_info_baileys folder to retry.');
            }
        } else if(connection === 'open') {
            console.log('\n=========================================');
            console.log('WHATSAPP CONNECTION ESTABLISHED SUCCESSFULLY!');
            console.log('=========================================\n');
            currentQr = null;
            
            // Start morning agenda timer if not already running
            if (!agendaInterval) {
                agendaInterval = setInterval(async () => {
                    if (!activeSock || !activeSock.user) return;
                    const now = new Date();
                    const hour = now.getHours();
                    const dateStr = now.toISOString().split('T')[0];
                    if (hour === 8 && lastAgendaSentDate !== dateStr) {
                        try {
                            const sender = activeSock.user.id.split(':')[0];
                            const phone = sender.split('@')[0];
                            console.log(`Checking daily morning agenda for phone ${phone}...`);
                            
                            const agendaUrl = `http://localhost:8000/api/whatsapp/agenda?phone=${phone}`;
                            const response = await axios.get(agendaUrl);
                            if (response.data && response.data.message) {
                                const jid = sender + '@s.whatsapp.net';
                                await activeSock.sendMessage(jid, { text: response.data.message });
                                lastAgendaSentDate = dateStr;
                                console.log('Morning agenda sent successfully to', jid);
                            }
                        } catch(err) {
                            console.error('Failed to send morning agenda:', err.message);
                        }
                    }
                }, 60000);
            }
 
            // Clean QR file on successful connect
            try {
                if (fs.existsSync(QR_FILE_PATH)) {
                    fs.unlinkSync(QR_FILE_PATH);
                }
            } catch(e) {}
        }
    });
    
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                // Ignore messages sent by ourselves
                if (!msg.key.fromMe && msg.message) {
                    const sender = msg.key.remoteJid;
                    const senderName = msg.pushName || 'WhatsApp User';
                    const isGroup = sender.endsWith('@g.us');
                    
                    if (isGroup) {
                        // GROUP INTELLIGENCE: Parse academic events
                        const groupText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                        if (groupText && groupText.length > 5) {
                            try {
                                const grpResp = await axios.post('http://localhost:8000/api/wa-group-intelligence', {
                                    group_jid: sender, group_name: senderName || 'College Group',
                                    sender_name: msg.pushName || 'Unknown', message: groupText,
                                    phone: activeSock?.user?.id?.split(':')[0] || null
                                });
                                if (grpResp.data?.status === 'processed') {
                                    const ev = grpResp.data.event;
                                    const myJid = activeSock?.user?.id;
                                    if (myJid && ev?.summary) {
                                        const pJid = myJid.split(':')[0] + '@s.whatsapp.net';
                                        await activeSock.sendMessage(pJid, { text: '🔔 *Kora Group Alert*\n\n📌 *' + ev.event_type + '* detected!\n\n' + ev.summary + (ev.date ? '\n📅 ' + ev.date : '') + (ev.time ? '\n⏰ ' + ev.time : '') + '\n\n_Saved to Kora dashboard._' });
                                    }
                                }
                            } catch(e) { console.error('Group intel error:', e.message); }
                        }
                        continue;
                    }

                    // Check for audio/voice message
                    const audio = msg.message.audioMessage;
                    if (audio) {
                        console.log(`Received audio/voice message from ${senderName} (${sender})`);
                        try {
                            const buffer = await downloadMediaMessage(
                                msg,
                                'buffer',
                                {},
                                { 
                                    logger: pino({ level: 'silent' }),
                                    reuploadRequest: sock.updateMediaMessage
                                }
                            );
                            
                            const FormData = require('form-data');
                            const form = new FormData();
                            form.append('file', buffer, {
                                filename: 'voice.ogg',
                                contentType: audio.mimetype || 'audio/ogg'
                            });
                            form.append('sender', sender);
                            if (audio.seconds) {
                                form.append('duration_ms', (audio.seconds * 1000).toString());
                            }
                            
                            const response = await axios.post('http://localhost:8000/api/chat/voice', form, {
                                headers: form.getHeaders()
                            });
                            
                            console.log(`Voice endpoint response:`, response.data);
                            if (response.data && response.data.reply) {
                                await sock.sendMessage(sender, { text: response.data.reply });
                                console.log(`Replied to WhatsApp voice message from ${senderName}`);
                            }
                        } catch (err) {
                            console.error('Failed to process voice note webhook:', err.message);
                        }
                        continue;
                    }

                    // Check for image message (Receipt or Timetable)
                    const image = msg.message.imageMessage;
                    if (image) {
                        console.log(`Received image message from ${senderName} (${sender})`);
                        try {
                            const buffer = await downloadMediaMessage(
                                msg,
                                'buffer',
                                {},
                                { 
                                    logger: pino({ level: 'silent' }),
                                    reuploadRequest: sock.updateMediaMessage
                                }
                            );
                            
                            const FormData = require('form-data');
                            const form = new FormData();
                            form.append('file', buffer, {
                                filename: 'image.jpg',
                                contentType: image.mimetype || 'image/jpeg'
                            });
                            form.append('user_id', sender);
                            
                            const response = await axios.post('http://localhost:8000/api/ingest/image', form, {
                                headers: form.getHeaders()
                            });
                            
                            console.log(`Image ingest response:`, response.data);
                            if (response.data && response.data.message) {
                                await sock.sendMessage(sender, { text: `ðŸ“¸ Kora parsed your image:\n\n${response.data.message}` });
                                console.log(`Replied to WhatsApp image message from ${senderName}`);
                            }
                        } catch (err) {
                            console.error('Failed to process image ingest:', err.message);
                            await sock.sendMessage(sender, { text: `âŒ Failed to parse image. Make sure it's a clear receipt or class timetable!` });
                        }
                        continue;
                    }

                    // Check for PDF/document message (Syllabus or Circular)
                    const document = msg.message.documentMessage;
                    if (document && (document.mimetype === 'application/pdf' || document.fileName?.endsWith('.pdf'))) {
                        console.log(`Received document/PDF message from ${senderName} (${sender})`);
                        try {
                            const buffer = await downloadMediaMessage(
                                msg,
                                'buffer',
                                {},
                                { 
                                    logger: pino({ level: 'silent' }),
                                    reuploadRequest: sock.updateMediaMessage
                                }
                            );
                            
                            const FormData = require('form-data');
                            const form = new FormData();
                            form.append('file', buffer, {
                                filename: document.fileName || 'circular.pdf',
                                contentType: 'application/pdf'
                            });
                            form.append('user_id', sender);
                            
                            const response = await axios.post('http://localhost:8000/api/ingest/pdf', form, {
                                headers: form.getHeaders()
                            });
                            
                            console.log(`PDF ingest response:`, response.data);
                            if (response.data && response.data.message) {
                                await sock.sendMessage(sender, { text: `ðŸ“„ Kora ingested document:\n\n${response.data.message}` });
                                console.log(`Replied to WhatsApp document message from ${senderName}`);
                            }
                        } catch (err) {
                            console.error('Failed to process PDF ingest:', err.message);
                            await sock.sendMessage(sender, { text: `âŒ Failed to parse document. Ensure the PDF is a readable circular or exam schedule!` });
                        }
                        continue;
                    }

                    const text = msg.message.conversation || 
                                 msg.message.extendedTextMessage?.text || 
                                 msg.message.imageMessage?.caption;
                    if (text) {
                        try {
                            const logEntry = `[${new Date().toISOString()}] ${senderName} (${sender}): ${text}\n`;
                            fs.appendFileSync(path.join(__dirname, 'messages.log'), logEntry);
                        } catch(e) {}

                        console.log(`Received message from ${senderName} (${sender}): '${text}'`);
                        
                        // Send webhook to FastAPI
                        try {
                            const response = await axios.post(BACKEND_URL, {
                                message: text,
                                sender: sender,
                                sender_name: senderName
                            });
                            console.log(`FastAPI process reply: ${response.data.reply}`);
                            
                            // Send reply back to the WhatsApp user
                            if (response.data && response.data.reply) {
                                await sock.sendMessage(sender, { text: response.data.reply });
                                console.log(`Replied to WhatsApp user ${senderName}`);
                            }
                        } catch (err) {
                            console.error('Failed to send webhook to backend:', err.message);
                        }
                    }
                }
            }
        }
    });
    } catch (err) {
        console.error('Error in WhatsApp bridge socket loop, retrying in 5 seconds:', err);
        setTimeout(startSock, 5000);
    }
}

startSock().catch(err => {
    console.error('Fatal error starting socket:', err);
});

