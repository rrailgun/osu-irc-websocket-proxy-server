const express = require('express');
const expressWs = require('express-ws');
const IRC = require('irc-framework');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const OSU_CLIENT_ID = process.env.OSU_CLIENT_ID;
const OSU_CLIENT_SECRET = process.env.OSU_CLIENT_SECRET;
let bearerToken = null;
let tokenExpiresAt = 0;

async function refreshToken() {
  let params = new URLSearchParams();
  params.append('client_id', OSU_CLIENT_ID);
  params.append('client_secret', OSU_CLIENT_SECRET);
  params.append('grant_type', 'client_credentials');
  params.append('scope', 'public');

  let res = await fetch('https://osu.ppy.sh/oauth/token', {
    method: 'POST',
    body: params,
  });

  let json = await res.json();
  bearerToken = json.access_token;
  // Set expiry time a bit earlier than actual expiry for safety (in ms)
  tokenExpiresAt = Date.now() + (json.expires_in - 60) * 1000;
}

async function getValidToken() {
  if (!bearerToken || Date.now() >= tokenExpiresAt) {
    await refreshToken();
  }
  return bearerToken;
}

const app = express();
const wsInstance = expressWs(app); // Attach WebSocket support to Express
const apiRouter = express.Router();
wsInstance.applyTo(apiRouter);

const connectedUsers = [];

app.use(cors());
app.use(bodyParser.json());

apiRouter.get('/', (req, res) => {
    res.send('IRC Proxy running with express-ws');
});

// WebSocket route for IRC proxy
apiRouter.ws('/', (ws, req) => {
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
                    connectedUsers.splice(connectedUsers.indexOf(username), 1);
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
                    connectedUsers.push(username);
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

apiRouter.get('/api/match/:matchId', async (req, res) => {
    let token = await getValidToken();
    fetch(`https://osu.ppy.sh/api/v2/matches/${req.params.matchId}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'osu-api-express/1.0',
        }
    })
        .then(response => response.json())
        .then(data => res.json(data));
});

apiRouter.get('/api/connected-users', (req,res) => {
    res.send(connectedUsers);
})

app.use('/chat', apiRouter)

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`IRC proxy server listening on http://localhost:${PORT}`);
});
