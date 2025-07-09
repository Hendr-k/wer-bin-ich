const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let lobbies = {};

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

wss.on('connection', (ws) => {
  console.log('New client connected');

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    console.log('Received:', data);

    if (data.type === 'createLobby') {
      const lobbyId = Math.random().toString(36).substring(2, 8);
      const playerName = data.playerName.trim().toLowerCase();
      lobbies[lobbyId] = {
        players: [playerName],
        host: playerName,
        phase: 'lobby',
        characters: {},
        imageUrls: {},
        revealedPlayers: [],
        currentPlayer: null,
        currentCharacter: null
      };
      ws.lobbyId = lobbyId;
      ws.playerName = playerName;
      ws.send(JSON.stringify({
        type: 'lobbyCreated',
        lobbyId,
        playerName,
        isHost: true,
        players: lobbies[lobbyId].players
      }));
    } else if (data.type === 'joinLobby') {
      const lobbyId = data.lobbyId;
      const playerName = data.playerName.trim().toLowerCase();
      if (lobbies[lobbyId]) {
        if (lobbies[lobbyId].players.includes(playerName)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Spielername bereits vergeben' }));
          return;
        }
        lobbies[lobbyId].players.push(playerName);
        ws.lobbyId = lobbyId;
        ws.playerName = playerName;
        broadcast(lobbyId, {
          type: 'playerJoined',
          playerName,
          lobbyId,
          players: lobbies[lobbyId].players,
          isHost: false
        });
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Lobby nicht gefunden' }));
      }
    } else if (data.type === 'leaveLobby') {
      const lobbyId = ws.lobbyId;
      const playerName = ws.playerName;
      if (lobbies[lobbyId]) {
        lobbies[lobbyId].players = lobbies[lobbyId].players.filter(p => p !== playerName);
        if (playerName === lobbies[lobbyId].host) {
          broadcast(lobbyId, { type: 'playerLeft', players: lobbies[lobbyId].players, lobbyDeleted: true });
          delete lobbies[lobbyId];
        } else {
          broadcast(lobbyId, { type: 'playerLeft', players: lobbies[lobbyId].players });
        }
      }
    } else if (data.type === 'startAssignment') {
      if (lobbies[data.lobbyId] && data.playerName === lobbies[data.lobbyId].host) {
        lobbies[data.lobbyId].phase = 'assignment';
        const assignTo = lobbies[data.lobbyId].players[Math.floor(Math.random() * lobbies[data.lobbyId].players.length)];
        broadcast(data.lobbyId, { type: 'assignmentStarted', assignTo });
      }
    } else if (data.type === 'assignCharacter') {
      if (lobbies[data.lobbyId]) {
        lobbies[data.lobbyId].characters[data.playerName] = data.character;
        lobbies[data.lobbyId].imageUrls[data.playerName] = data.imageUrl || 'https://cdn-icons-png.flaticon.com/512/747/747376.png';
        broadcast(data.lobbyId, {
          type: 'characterAssigned',
          player: data.playerName,
          character: data.character,
          imageUrl: lobbies[data.lobbyId].imageUrls[data.playerName],
          players: lobbies[data.lobbyId].players
        });
        if (Object.keys(lobbies[data.lobbyId].characters).length === lobbies[data.lobbyId].players.length) {
          lobbies[data.lobbyId].phase = 'game';
          lobbies[data.lobbyId].currentPlayer = lobbies[data.lobbyId].players[0];
          broadcast(data.lobbyId, {
            type: 'gameStarted',
            currentPlayer: lobbies[data.lobbyId].currentPlayer,
            currentCharacter: lobbies[data.lobbyId].characters[lobbies[data.lobbyId].currentPlayer],
            players: lobbies[data.lobbyId].players,
            imageUrls: lobbies[data.lobbyId].imageUrls
          });
        } else {
          const assignTo = lobbies[data.lobbyId].players[Math.floor(Math.random() * lobbies[data.lobbyId].players.length)];
          broadcast(data.lobbyId, { type: 'assignmentStarted', assignTo });
        }
      }
    } else if (data.type === 'nextPlayer') {
      if (lobbies[data.lobbyId]) {
        const currentIndex = lobbies[data.lobbyId].players.indexOf(lobbies[data.lobbyId].currentPlayer);
        const nextIndex = (currentIndex + 1) % lobbies[data.lobbyId].players.length;
        lobbies[data.lobbyId].currentPlayer = lobbies[data.lobbyId].players[nextIndex];
        broadcast(data.lobbyId, {
          type: 'nextTurn',
          currentPlayer: lobbies[data.lobbyId].currentPlayer,
          currentCharacter: lobbies[data.lobbyId].characters[lobbies[data.lobbyId].currentPlayer],
          players: lobbies[data.lobbyId].players,
          revealedPlayers: lobbies[data.lobbyId].revealedPlayers,
          imageUrls: lobbies[data.lobbyId].imageUrls
        });
      }
    } else if (data.type === 'revealCharacter') {
      if (lobbies[data.lobbyId]) {
        lobbies[data.lobbyId].revealedPlayers.push(data.player.trim().toLowerCase());
        broadcast(data.lobbyId, {
          type: 'revealCharacter',
          currentPlayer: lobbies[data.lobbyId].currentPlayer,
          character: lobbies[data.lobbyId].characters[data.player],
          revealedPlayers: lobbies[data.lobbyId].revealedPlayers,
          imageUrls: lobbies[data.lobbyId].imageUrls
        });
        if (lobbies[data.lobbyId].revealedPlayers.length === lobbies[data.lobbyId].players.length) {
          broadcast(data.lobbyId, {
            type: 'gameEnded',
            characters: lobbies[data.lobbyId].characters,
            imageUrls: lobbies[data.lobbyId].imageUrls,
            players: lobbies[data.lobbyId].players,
            revealedPlayers: lobbies[data.lobbyId].revealedPlayers
          });
        }
      }
    } else if (data.type === 'restartGame') {
      if (lobbies[data.lobbyId] && data.playerName === lobbies[data.lobbyId].host) {
        lobbies[data.lobbyId].phase = 'lobby';
        lobbies[data.lobbyId].characters = {};
        lobbies[data.lobbyId].imageUrls = {};
        lobbies[data.lobbyId].revealedPlayers = [];
        lobbies[data.lobbyId].currentPlayer = null;
        broadcast(data.lobbyId, {
          type: 'lobbyCreated',
          lobbyId: data.lobbyId,
          playerName: data.playerName,
          isHost: true,
          players: lobbies[data.lobbyId].players
        });
      }
    } else if (data.type === 'restoreState') {
      const lobbyId = data.lobbyId;
      const playerName = data.playerName.trim().toLowerCase();
      if (lobbies[lobbyId]) {
        if (!lobbies[lobbyId].players.includes(playerName)) {
          lobbies[lobbyId].players.push(playerName);
        }
        ws.lobbyId = lobbyId;
        ws.playerName = playerName;
        ws.send(JSON.stringify({
          type: 'restoreState',
          lobbyId,
          playerName,
          isHost: playerName === lobbies[lobbyId].host,
          players: lobbies[lobbyId].players,
          phase: lobbies[lobbyId].phase,
          characters: lobbies[lobbyId].characters,
          imageUrls: lobbies[lobbyId].imageUrls,
          revealedPlayers: lobbies[lobbyId].revealedPlayers,
          currentPlayer: lobbies[lobbyId].currentPlayer,
          currentCharacter: lobbies[lobbyId].currentPlayer ? lobbies[lobbyId].characters[lobbies[lobbyId].currentPlayer] : null
        }));
        broadcast(lobbyId, {
          type: 'playerJoined',
          playerName,
          lobbyId,
          players: lobbies[lobbyId].players,
          isHost: playerName === lobbies[lobbyId].host
        });
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Lobby nicht gefunden' }));
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    const lobbyId = ws.lobbyId;
    const playerName = ws.playerName;
    if (lobbyId && lobbies[lobbyId]) {
      lobbies[lobbyId].players = lobbies[lobbyId].players.filter(p => p !== playerName);
      if (playerName === lobbies[lobbyId].host) {
        broadcast(lobbyId, { type: 'playerLeft', players: lobbies[lobbyId].players, lobbyDeleted: true });
        delete lobbies[lobbyId];
      } else {
        broadcast(lobbyId, { type: 'playerDisconnected', players: lobbies[lobbyId].players });
      }
    }
  });
});

function broadcast(lobbyId, message) {
  wss.clients.forEach(client => {
    if (client.lobbyId === lobbyId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});