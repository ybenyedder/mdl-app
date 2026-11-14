type SseClient = {
  id: string;
  channel: string;
  send: (event: string, data: unknown) => void;
};

const clients = new Map<string, SseClient>();

export function registerSseClient(
  channel: string,
  controller: ReadableStreamDefaultController<Uint8Array>
): () => void {
  const id = crypto.randomUUID();
  const encoder = new TextEncoder();

  const send = (event: string, data: unknown) => {
    try {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(payload));
    } catch {
      clients.delete(id);
    }
  };

  clients.set(id, { id, channel, send });
  send('connected', { channel, ts: Date.now() });

  const heartbeat = setInterval(() => {
    try {
      controller.enqueue(encoder.encode(': keepalive\n\n'));
    } catch {
      clearInterval(heartbeat);
      clients.delete(id);
    }
  }, 20_000);

  return () => {
    clearInterval(heartbeat);
    clients.delete(id);
  };
}

export function broadcastSse(channel: string, event: string, data: unknown): void {
  for (const client of clients.values()) {
    if (client.channel === channel) {
      client.send(event, data);
    }
  }
}
