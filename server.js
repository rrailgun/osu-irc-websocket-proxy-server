const express = require('express');
const expressWs = require('express-ws');
const IRC = require('irc-framework');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
expressWs(app); // Attach WebSocket support to Express

app.use(cors());
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('IRC Proxy running with express-ws');
});

// WebSocket route for IRC proxy
app.ws('/', (ws, req) => {
    let ircClient = null;

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            if (data.type === 'connect') {
                const { username, password } = data;

                ircClient = new IRC.Client();

                ircClient.on('error', (error) => {
                    console.log(`[IRC] Error:`, error);
                    ws.send(JSON.stringify({ type: 'error', error: error.message || error }));
                });

                ircClient.on('close', (e) => {
                    console.log(e);
                    ws.send(JSON.stringify({ type: 'close', event: e }));
                });

                ircClient.connect({
                    host: 'irc.ppy.sh',
                    port: 6667,
                    ssl: false,
                    nick: username,
                    username,
                    password
                });

                ircClient.on('registered', () => {
                    console.log(`[IRC] Connected as ${username}`);
                    ws.send(JSON.stringify({ type: 'connected' }));
                });

                ircClient.on('message', (event) => {
                    ws.send(JSON.stringify(event));
                });

                ircClient.on('join', (event) => {
                    ws.send(JSON.stringify({
                        type: 'join',
                        channel: event.channel,
                        nick: event.nick
                    }));
                });
            }

            if (ircClient) {
                switch (data.type) {
                    case 'join':
                        ircClient.join(data.channel);
                        break;
                    case 'message':
                        ircClient.say(data.target, data.message);
                        break;
                    case 'part':
                        ircClient.part(data.target, '');
                        break;
                    case 'quit':
                        ircClient.quit(data.message || 'Client quit');
                        break;
                }
            }
        } catch (err) {
            console.error('[WS] Failed to parse message:', err);
            ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
        }
    });

    ws.on('close', () => {
        console.log('[WS] WebSocket closed');
        if (ircClient) {
            ircClient.quit('WebSocket closed');
        }
    });
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`IRC proxy server listening on http://localhost:${PORT}`);
});
