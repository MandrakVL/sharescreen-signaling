const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            service: 'ShareScreen Signaling Server',
            rooms: rooms.size
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

const wss = new WebSocketServer({ server });

const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function send(ws, message) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(message));
    }
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.roomCode = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch (e) {
            return;
        }

        switch (msg.type) {
            case 'create-room': {
                if (ws.roomCode) {
                    send(ws, { type: 'error', message: 'Voce ja esta em uma sala.' });
                    return;
                }

                let roomCode;
                let attempts = 0;
                do {
                    roomCode = generateRoomCode();
                    attempts++;
                } while (rooms.has(roomCode) && attempts < 100);

                if (rooms.has(roomCode)) {
                    send(ws, { type: 'error', message: 'Nao foi possivel criar a sala. Tente novamente.' });
                    return;
                }

                rooms.set(roomCode, { peers: [ws] });
                ws.roomCode = roomCode;

                send(ws, { type: 'room-created', roomCode });
                console.log(`[Room] Criada: ${roomCode}`);
                break;
            }

            case 'join-room': {
                if (ws.roomCode) {
                    send(ws, { type: 'error', message: 'Voce ja esta em uma sala.' });
                    return;
                }

                const { roomCode } = msg;
                if (!roomCode || typeof roomCode !== 'string') {
                    send(ws, { type: 'error', message: 'Codigo invalido.' });
                    return;
                }

                const room = rooms.get(roomCode.toUpperCase());
                if (!room) {
                    send(ws, { type: 'error', message: 'Sala nao encontrada. Verifique o codigo.' });
                    return;
                }

                if (room.peers.length >= 2) {
                    send(ws, { type: 'error', message: 'Sala cheia.' });
                    return;
                }

                room.peers.push(ws);
                ws.roomCode = roomCode.toUpperCase();

                send(room.peers[0], { type: 'peer-joined' });
                send(ws, { type: 'room-joined', roomCode: roomCode.toUpperCase() });

                console.log(`[Room] ${roomCode.toUpperCase()} - Peer entrou (${room.peers.length}/2)`);
                break;
            }

            case 'offer':
            case 'answer':
            case 'ice-candidate':
            case 'stop-sharing': {
                if (!ws.roomCode) return;
                const room = rooms.get(ws.roomCode);
                if (!room) return;

                const otherPeer = room.peers.find(p => p !== ws);
                if (otherPeer) {
                    send(otherPeer, msg);
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        if (ws.roomCode) {
            const room = rooms.get(ws.roomCode);
            if (room) {
                room.peers = room.peers.filter(p => p !== ws);

                room.peers.forEach(peer => {
                    send(peer, { type: 'peer-disconnected' });
                });

                if (room.peers.length === 0) {
                    rooms.delete(ws.roomCode);
                    console.log(`[Room] ${ws.roomCode} removida (vazia)`);
                } else {
                    console.log(`[Room] ${ws.roomCode} - Peer saiu (${room.peers.length}/2)`);
                }
            }
            ws.roomCode = null;
        }
    });

    ws.on('error', (err) => {
        console.error('[WS] Erro:', err.message);
    });
});

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

server.listen(PORT, () => {
    console.log(`\n  ShareScreen Signaling Server`);
    console.log(`  Rodando na porta ${PORT}`);
    console.log(`  WebSocket: ws://localhost:${PORT}`);
    console.log(`  Health:    http://localhost:${PORT}/health\n`);
});
