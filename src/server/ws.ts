import WebSocket, {createWebSocketStream, WebSocketServer} from "ws";
import http from "http";
import net from "net";
import Buffer from "buffer";
import * as tls from "tls";
import {PPHttpRule} from "../rule/http-rule";
import {ParsedQs} from "qs";
import {PPWsRule} from "../rule/ws-rule";
import {PPPassThroughWsHandler} from "../handler/ws-handler";

export type PPIncomingMessage = http.IncomingMessage & {
    protocol: string;
    hostname: string;
    query: ParsedQs;
    url: string;
}

export class PPWebsocketProxy {
    private readonly rules: PPWsRule[];
    private wss: WebSocketServer;

    constructor() {
        this.rules = [];
        this.wss = new WebSocketServer({
            noServer: true
        });
        this.wss.on('connection', this.handleConnection.bind(this));
    }

    addRule(rule?: PPWsRule) {
        if (!rule) {
            rule = new PPWsRule()
        }
        this.rules.push(rule);
        return rule;
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

    async handleConnection(ws: WebSocket.WebSocket, request: PPIncomingMessage) {
        delete request.headers["accept-encoding"]
        delete request.headers.connection;
        delete request.headers.upgrade;
        delete request.headers["sec-websocket-version"];
        delete request.headers["sec-websocket-extensions"];
        delete request.headers["sec-websocket-key"];

        // Check rules
        for (let rule of this.rules) {
            if (await rule.test(request)) {
                // async
                return rule.handle(request, ws);
            }
        }

        // Forward traffic
        const pass = new PPPassThroughWsHandler();
        pass.handle(request, ws);
    }
}