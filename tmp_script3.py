with open('apps/wa-bridge/index.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add /status endpoint
status_ep = '''            if (req.method === 'GET' && req.url === '/status') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    status: 'online', 
                    connected: activeSock && activeSock.user ? true : false,
                    user: activeSock ? activeSock.user : null
                }));
                return;
            }
            if (req.method === 'POST' && req.url === '/send') {'''
content = content.replace("if (req.method === 'POST' && req.url === '/send') {", status_ep)

# Add group handling and logging
group_log = '''                    if (text) {
                        const sender = msg.key.remoteJid;
                        const senderName = msg.pushName || 'WhatsApp User';
                        
                        try {
                            const logEntry = `[${new Date().toISOString()}] ${senderName} (${sender}): ${text}\\n`;
                            fs.appendFileSync(path.join(__dirname, 'messages.log'), logEntry);
                        } catch(e) {}

                        const isGroup = sender.endsWith('@g.us');
                        if (isGroup) {
                            console.log('Ignoring group message from', sender);
                            continue;
                        }

                        console.log(`Received message from ${senderName} (${sender}): '${text}'`);'''

content = content.replace("                    if (text) {\n                        const sender = msg.key.remoteJid;\n                        const senderName = msg.pushName || 'WhatsApp User';\n                        console.log(`Received message from ${senderName} (${sender}): '${text}'`);", group_log)

with open('apps/wa-bridge/index.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')