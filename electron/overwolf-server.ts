import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  helperPacketSchema,
  type MatchDetection,
} from "../src/core/detection.js";

export const HELPER_PORT = 32145;
export async function startOverwolfServer(
  token: string,
  detection: MatchDetection,
  port = HELPER_PORT,
) {
  const http = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  let authenticated: WebSocket | undefined;
  const sockets = new Set<WebSocket>();
  http.on("upgrade", (request, socket, head) => {
    if (request.url !== "/timer" || sockets.size >= 2) {
      socket.destroy();
      return;
    }
    server.handleUpgrade(request, socket, head, (ws) =>
      server.emit("connection", ws),
    );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    let paired = false,
      sequence = -1,
      count = 0,
      windowStart = Date.now();
    const timeout = setTimeout(() => {
      if (!paired) socket.terminate();
    }, 3000);
    socket.on("error", () => {});
    socket.on("message", (data) => {
      try {
        const now = Date.now();
        if (now - windowStart > 1000) {
          count = 0;
          windowStart = now;
        }
        if (++count > 20) {
          socket.close(1008);
          return;
        }
        const raw = JSON.parse(data.toString());
        if (!paired) {
          if (
            raw.kind !== "pair" ||
            typeof raw.token !== "string" ||
            raw.token.length !== token.length ||
            !timingSafeEqual(Buffer.from(raw.token), Buffer.from(token)) ||
            authenticated
          ) {
            socket.close(1008);
            return;
          }
          paired = true;
          authenticated = socket;
          clearTimeout(timeout);
          detection.connection(true);
          socket.send(JSON.stringify({ kind: "paired" }));
          return;
        }
        const packet = helperPacketSchema.parse(raw);
        if (packet.sequence <= sequence) return;
        sequence = packet.sequence;
        detection.receive(packet);
      } catch {
        socket.close(1008);
      }
    });
    socket.on("close", () => {
      clearTimeout(timeout);
      sockets.delete(socket);
      if (authenticated === socket) {
        authenticated = undefined;
        detection.connection(false);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, "127.0.0.1", () => {
      http.removeListener("error", reject);
      resolve();
    });
  });
  return {
    port: (http.address() as { port: number }).port,
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
