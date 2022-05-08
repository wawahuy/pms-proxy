import WebSocket, {createWebSocketStream, WebSocketServer} from "ws";
import http from "http";
import net from "net";
import Buffer from "buffer";
import * as tls from "tls";

export type PPIncomingMessage = http.IncomingMessage & {
    protocol: string;
    query: string;
    hostname: string;
}

export class PPWebsocketProxy {
    private wss: WebSocket.WebSocketServer;

    constructor() {
        this.wss = new WebSocketServer({
            noServer: true
        });
        this.wss.on('connection', this.handleConnection.bind(this));
    }

    handleUpgrade(request: PPIncomingMessage, socket: net.Socket, head: Buffer) {
        request.hostname = request.headers[':authority']?.toString() || request.headers['host']?.toString();

        if (request.headers[':scheme']) {
            request.protocol =  request.headers[':scheme']?.toString();
        } else if (request.socket instanceof tls.TLSSocket) {
            request.protocol = 'wss';
        } else {
            request.protocol = 'ws';
        }

        if (!request.url.match(/^ws[s]?:\/\//gmi)) {
            request.url = `${request.protocol}://${request.hostname}${request.url}`
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit('connection', ws, request);
        });
    }

    handleConnection(wsA: WebSocket.WebSocket, request: PPIncomingMessage) {

        delete request.headers["accept-encoding"]
        delete request.headers.connection;
        delete request.headers.upgrade;
        delete request.headers["sec-websocket-version"];
        delete request.headers["sec-websocket-extensions"];
        delete request.headers["sec-websocket-key"];

        let queueData: any[] = [];
        const wsB = new WebSocket(request.url, { headers: request.headers });
        wsB.on('open', () => {
            queueData.forEach(data => {
                wsB.send(data);
            })
            queueData = [];
        })
        wsB.on('message', (data) => {
            wsA.send(data);
        })
        wsB.on('close', (code, reason) => {
            wsB.close(code, reason);
        })
        wsB.on('error', (err) => {
            wsB.close();
        })

        wsA.on('message', data => {
            if (wsB.readyState !== WebSocket.OPEN) {
                queueData.push(data);
            } else {
                wsB.send(data)
            }
        })
        wsA.on('close', (code, reason) => {
            wsA.close(code, reason);
        })
        wsA.on('error', (err) => {
            wsA.close();
        })
    }
}