const { setTimeout: sleep } = require('node:timers/promises');

const url = 'ws://localhost:8081/ws';
const token = process.env.JWT1;
const threadId = process.env.THREAD;
const traceId = 'preflight-ws-1';

if (!token || !threadId) {
  console.error('Missing JWT1 or THREAD env');
  process.exit(1);
}

const ws = new WebSocket(url, {
  headers: {
    'X-Trace-Id': traceId,
  },
});

const send = (obj) => {
  ws.send(JSON.stringify(obj));
};

ws.onopen = async () => {
  console.log('ws open');
  const pingTimer = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      send({ type: 'ping', trace_id: traceId });
    }
  }, 25000);
  send({ type: 'auth', token, trace_id: traceId });
  await sleep(200);
  send({ type: 'sub', thread_id: threadId, trace_id: traceId });
  await sleep(200);
  send({
    type: 'msg',
    thread_id: threadId,
    msg_type: 'text',
    client_msg_id: 'a4f1b28c-8c3c-4da9-9c08-86a3332199f7',
    content: { text: 'ws hello' },
    trace_id: traceId,
  });
  await sleep(200);
  send({ type: 'read', thread_id: threadId, last_read_seq: 2, trace_id: traceId });
  await sleep(90000);
  clearInterval(pingTimer);
  ws.close();
};

ws.onmessage = (ev) => {
  console.log('ws message', ev.data.toString());
};

ws.onerror = (err) => {
  console.error('ws error', err.message || err);
};

ws.onclose = () => {
  console.log('ws closed');
};
