const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*'
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from public and root
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Standard 13 Yahtzee categories
const upperCategories = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
const lowerCategories = ['threeOfAKind', 'fourOfAKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];

function createInitialPoints() {
    const points = {};
    for (const cat of [...upperCategories, ...lowerCategories]) {
        points[cat] = { value: 0, fixed: false };
    }
    return points;
}

function getUpperScore(points) {
    let sum = 0;
    for (const cat of upperCategories) {
        if (points[cat] && points[cat].fixed) {
            sum += points[cat].value;
        }
    }
    return sum;
}

function getUpperBonus(points) {
    return getUpperScore(points) >= 64 ? 35 : 0;
}

function calculateTotalScore(points) {
    let total = 0;
    for (const key in points) {
        if (points[key].fixed) {
            total += points[key].value;
        }
    }
    total += getUpperBonus(points);
    return total;
}

function calcP(point, dices) {
    if (!dices || dices.length === 0 || dices[0].value == null) return 0;
    const values = dices.map(d => d.value);
    const counts = {};
    for (const v of values) {
        counts[v] = (counts[v] || 0) + 1;
    }

    switch (point) {
        case 'd1': return (counts[1] || 0) * 1;
        case 'd2': return (counts[2] || 0) * 2;
        case 'd3': return (counts[3] || 0) * 3;
        case 'd4': return (counts[4] || 0) * 4;
        case 'd5': return (counts[5] || 0) * 5;
        case 'd6': return (counts[6] || 0) * 6;

        case 'threeOfAKind':
            for (const c in counts) {
                if (counts[c] >= 3) return values.reduce((a, b) => a + b, 0);
            }
            return 0;

        case 'fourOfAKind':
            for (const c in counts) {
                if (counts[c] >= 4) return values.reduce((a, b) => a + b, 0);
            }
            return 0;

        case 'fullHouse': {
            let hasThree = false, hasTwo = false;
            for (const c in counts) {
                if (counts[c] === 3) hasThree = true;
                if (counts[c] === 2) hasTwo = true;
                if (counts[c] === 5) { hasThree = true; hasTwo = true; }
            }
            return (hasThree && hasTwo) ? 25 : 0;
        }

        case 'smallStraight': {
            const unique = [...new Set(values)].sort((a, b) => a - b);
            const straights = [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]];
            for (const s of straights) {
                if (s.every(num => unique.includes(num))) return 30;
            }
            return 0;
        }

        case 'largeStraight': {
            const unique = [...new Set(values)].sort((a, b) => a - b);
            const straights = [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]];
            for (const s of straights) {
                if (s.every(num => unique.includes(num))) return 40;
            }
            return 0;
        }

        case 'yahtzee':
            for (const c in counts) {
                if (counts[c] === 5) return 50;
            }
            return 0;

        case 'chance':
            return values.reduce((a, b) => a + b, 0);

        default:
            return 0;
    }
}

// Active rooms map
const rooms = new Map();

function generateRoomId() {
    let id;
    do {
        id = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (rooms.has(id));
    return id;
}

function resetRoomState(room) {
    room.currentTurnIndex = 0;
    room.isGameOver = false;
    room.rematchVotes.clear();
    room.dices = [
        { value: null, keep: false },
        { value: null, keep: false },
        { value: null, keep: false },
        { value: null, keep: false },
        { value: null, keep: false }
    ];
    for (let i = 0; i < room.players.length; i++) {
        room.players[i].rolls = 3;
        room.players[i].score = 0;
        room.players[i].points = createInitialPoints();
    }
}

io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // Create Room
    socket.on('create_room', ({ playerName }) => {
        const roomId = generateRoomId();
        const player = {
            id: socket.id,
            name: playerName?.trim() || 'Player 1',
            playerIndex: 0,
            rolls: 3,
            score: 0,
            points: createInitialPoints()
        };

        const room = {
            id: roomId,
            players: [player],
            currentTurnIndex: 0,
            dices: [
                { value: null, keep: false },
                { value: null, keep: false },
                { value: null, keep: false },
                { value: null, keep: false },
                { value: null, keep: false }
            ],
            isGameOver: false,
            rematchVotes: new Set()
        };

        rooms.set(roomId, room);
        socket.join(roomId);
        socket.roomId = roomId;

        console.log(`[Room] Created: ${roomId} by ${player.name}`);
        socket.emit('room_created', {
            roomId,
            playerIndex: 0,
            playerName: player.name
        });
    });

    // Join Room
    socket.on('join_room', ({ roomId, playerName }) => {
        const cleanRoomId = roomId ? roomId.trim().toUpperCase() : '';
        const room = rooms.get(cleanRoomId);

        if (!room) {
            return socket.emit('join_error', { message: 'Room not found. Please check the code.' });
        }

        if (room.players.length >= 2) {
            return socket.emit('join_error', { message: 'Room is already full (2 players max).' });
        }

        const player = {
            id: socket.id,
            name: playerName?.trim() || 'Player 2',
            playerIndex: 1,
            rolls: 3,
            score: 0,
            points: createInitialPoints()
        };

        room.players.push(player);
        socket.join(cleanRoomId);
        socket.roomId = cleanRoomId;

        console.log(`[Room] ${player.name} joined room ${cleanRoomId}`);

        socket.emit('room_joined', {
            roomId: cleanRoomId,
            playerIndex: 1,
            playerName: player.name
        });

        // Start game for both players
        io.to(cleanRoomId).emit('game_started', {
            roomId: cleanRoomId,
            players: room.players.map(p => ({
                name: p.name,
                playerIndex: p.playerIndex,
                rolls: p.rolls,
                score: p.score,
                points: p.points
            })),
            currentTurnIndex: room.currentTurnIndex,
            dices: room.dices
        });
    });

    // Roll Dice
    socket.on('roll_dice', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room || room.isGameOver) return;

        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return; // Not active player's turn
        if (player.rolls <= 0) return;

        player.rolls--;

        // Roll unkept dice
        for (let i = 0; i < room.dices.length; i++) {
            if (!room.dices[i].keep) {
                room.dices[i].value = Math.floor(Math.random() * 6) + 1;
            }
        }

        io.to(roomId).emit('dice_rolled', {
            dices: room.dices,
            rollsLeft: player.rolls,
            playerIndex: room.currentTurnIndex
        });
    });

    // Toggle Keep Die
    socket.on('toggle_keep', ({ roomId, diceIndex }) => {
        const room = rooms.get(roomId);
        if (!room || room.isGameOver) return;

        const player = room.players[room.currentTurnIndex];
        if (!player || player.id !== socket.id) return;
        if (player.rolls >= 3) return; // Cannot hold before first roll
        if (diceIndex < 0 || diceIndex >= room.dices.length) return;

        room.dices[diceIndex].keep = !room.dices[diceIndex].keep;

        io.to(roomId).emit('keep_updated', {
            dices: room.dices,
            playerIndex: room.currentTurnIndex
        });
    });

    // Select Scorecard Category
    socket.on('select_category', ({ roomId, category }) => {
        const room = rooms.get(roomId);
        if (!room || room.isGameOver) return;

        const playerIndex = room.currentTurnIndex;
        const player = room.players[playerIndex];
        if (!player || player.id !== socket.id) return;
        if (player.rolls >= 3) return; // Must roll at least once
        if (!player.points[category] || player.points[category].fixed) return;

        const pointsToAdd = calcP(category, room.dices);
        const priorUpper = getUpperScore(player.points);

        player.points[category].value = pointsToAdd;
        player.points[category].fixed = true;
        player.score = calculateTotalScore(player.points);

        const newUpper = getUpperScore(player.points);
        const earnedBonus = (priorUpper < 64 && newUpper >= 64);

        // Check game over
        const isGameOver = room.players.every(p =>
            Object.values(p.points).every(pt => pt.fixed)
        );

        if (isGameOver) {
            room.isGameOver = true;
            let winner = null;
            if (room.players[0].score > room.players[1].score) {
                winner = 0;
            } else if (room.players[1].score > room.players[0].score) {
                winner = 1;
            } else {
                winner = -1; // Tie
            }

            io.to(roomId).emit('category_selected', {
                playerIndex,
                category,
                pointsAdded: pointsToAdd,
                totalScore: player.score,
                upperScore: newUpper,
                earnedBonus,
                nextTurnIndex: -1,
                rollsLeft: 0,
                dices: room.dices,
                isGameOver: true,
                winner,
                players: room.players.map(p => ({
                    name: p.name,
                    playerIndex: p.playerIndex,
                    rolls: p.rolls,
                    score: p.score,
                    points: p.points
                }))
            });
        } else {
            // Reset dice for next player
            for (let i = 0; i < room.dices.length; i++) {
                room.dices[i].value = null;
                room.dices[i].keep = false;
            }

            // Switch turn
            room.currentTurnIndex = 1 - room.currentTurnIndex;
            room.players[room.currentTurnIndex].rolls = 3;

            io.to(roomId).emit('category_selected', {
                playerIndex,
                category,
                pointsAdded: pointsToAdd,
                totalScore: player.score,
                upperScore: newUpper,
                earnedBonus,
                nextTurnIndex: room.currentTurnIndex,
                rollsLeft: 3,
                dices: room.dices,
                isGameOver: false
            });
        }
    });

    // Rematch Request
    socket.on('request_rematch', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        room.rematchVotes.add(socket.id);

        if (room.rematchVotes.size >= 2) {
            resetRoomState(room);
            io.to(roomId).emit('game_restarted', {
                players: room.players.map(p => ({
                    name: p.name,
                    playerIndex: p.playerIndex,
                    rolls: p.rolls,
                    score: p.score,
                    points: p.points
                })),
                currentTurnIndex: 0,
                dices: room.dices
            });
        } else {
            const votingPlayer = room.players.find(p => p.id === socket.id);
            socket.to(roomId).emit('rematch_offered', {
                playerName: votingPlayer ? votingPlayer.name : 'Opponent'
            });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log(`[Socket] Disconnected: ${socket.id}`);
        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            if (room) {
                const leavingPlayer = room.players.find(p => p.id === socket.id);
                socket.to(socket.roomId).emit('opponent_left', {
                    message: `${leavingPlayer ? leavingPlayer.name : 'Opponent'} has disconnected.`
                });
                rooms.delete(socket.roomId);
            }
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🎲 Yahtzee Online Multiplayer Server Running!`);
    console.log(`Local Access: http://localhost:${PORT}`);
    console.log(`Network Play: http://<YOUR-IP>:${PORT}`);
    console.log(`======================================================\n`);
});
