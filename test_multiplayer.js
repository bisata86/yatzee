const { io } = require('socket.io-client');
const http = require('http');

// First check if server is running, or start test instance
const TEST_PORT = 3456;
process.env.PORT = TEST_PORT;

// Require server module
require('./server.js');

const URL = `http://localhost:${TEST_PORT}`;

async function runTest() {
    console.log('Testing multiplayer server on', URL);

    const client1 = io(URL);
    const client2 = io(URL);

    await Promise.all([
        new Promise(res => client1.on('connect', res)),
        new Promise(res => client2.on('connect', res))
    ]);
    console.log('✔ Both clients connected');

    // 1. Client 1 creates room
    let roomId = null;
    await new Promise((resolve) => {
        client1.emit('create_room', { playerName: 'Alice' });
        client1.on('room_created', (data) => {
            console.log('✔ Room created with ID:', data.roomId);
            roomId = data.roomId;
            resolve();
        });
    });

    // 2. Client 2 joins room
    await new Promise((resolve) => {
        let startedCount = 0;
        const checkDone = () => {
            startedCount++;
            if (startedCount === 2) resolve();
        };

        client1.on('game_started', (data) => {
            console.log('✔ Client 1 received game_started');
            checkDone();
        });

        client2.on('game_started', (data) => {
            console.log('✔ Client 2 received game_started');
            checkDone();
        });

        client2.emit('join_room', { roomId, playerName: 'Bob' });
    });

    // 3. Client 1 (Alice) rolls dice
    await new Promise((resolve) => {
        let count = 0;
        const check = () => {
            count++;
            if (count === 2) resolve();
        };

        client1.on('dice_rolled', (data) => {
            console.log('✔ Client 1 received dice_rolled, values:', data.dices.map(d => d.value));
            check();
        });

        client2.on('dice_rolled', (data) => {
            console.log('✔ Client 2 received dice_rolled for player:', data.playerIndex);
            check();
        });

        client1.emit('roll_dice', { roomId });
    });

    // 4. Client 1 toggles keep on die 0
    await new Promise((resolve) => {
        client2.on('keep_updated', (data) => {
            console.log('✔ Client 2 received keep_updated, die 0 keep is:', data.dices[0].keep);
            if (data.dices[0].keep === true) resolve();
        });
        client1.emit('toggle_keep', { roomId, diceIndex: 0 });
    });

    // 5. Client 1 selects category 'chance'
    await new Promise((resolve) => {
        let count = 0;
        const check = () => {
            count++;
            if (count === 2) resolve();
        };

        client1.on('category_selected', (data) => {
            console.log('✔ Client 1 received category_selected: pointsAdded =', data.pointsAdded, 'nextTurnIndex =', data.nextTurnIndex);
            check();
        });

        client2.on('category_selected', (data) => {
            console.log('✔ Client 2 received category_selected: pointsAdded =', data.pointsAdded, 'nextTurnIndex =', data.nextTurnIndex);
            check();
        });

        client1.emit('select_category', { roomId, category: 'chance' });
    });

    // 6. Verify turn switched to Bob (Client 2)
    await new Promise((resolve) => {
        client1.on('dice_rolled', (data) => {
            console.log('✔ Bob rolled dice! Turn switch verified. Data playerIndex =', data.playerIndex);
            if (data.playerIndex === 1) resolve();
        });
        client2.emit('roll_dice', { roomId });
    });

    console.log('\n=============================================');
    console.log('🎉 ALL MULTIPLAYER TESTS PASSED SUCCESSFULLY!');
    console.log('=============================================\n');

    client1.disconnect();
    client2.disconnect();
    process.exit(0);
}

runTest().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
