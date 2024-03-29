import {MayBePromise} from "../types";
import {PPIncomingMessage, PPWebsocket, PPWebsocketRawData} from "../server/ws";
import WebSocket from "../../ws";
import * as Url from "url";
import {SocksProxyAgent} from "socks-proxy-agent";

export type PPCallbackWsHandler = (request: PPIncomingMessage, ws: WebSocket.WebSocket) => MayBePromise<void>;

export abstract class PPWsHandler {
    abstract handle(request: PPIncomingMessage, ws: WebSocket.WebSocket): MayBePromise<void>;
}


export class PPPassThroughWsHandler extends PPWsHandler {
    public static agents: SocksProxyAgent[];
    public static agentCurrent = 0;

    private callbackSend: (data: any) => any;
    private callbackReceive: (data: WebSocket.RawData | string) => any;

    constructor(
        private forwardDst?: string
    ) {
        super();
    }

    injectSend(callback: (data: any) => any) {
        this.callbackSend = callback;
    }

    injectReceive(callback: (data: PPWebsocketRawData | string) => any) {
        this.callbackReceive = callback;
    }

    handle(request: PPIncomingMessage, ws: PPWebsocket): MayBePromise<void> {
        this.rewriteHeaders(request);
        let queueData: any[] = [];
        let wsUrl = this.forwardDst ? this.forwardDst : request.url;
        let protocol = request.headers['sec-websocket-protocol'];

        const options: { [key: string]: any } = { headers: request.headers };
        const agents = PPPassThroughWsHandler.agents;
        if (agents?.length) {
            const agent = agents[PPPassThroughWsHandler.agentCurrent++];
            if (PPPassThroughWsHandler.agentCurrent >= agents.length) {
                PPPassThroughWsHandler.agentCurrent = 0;
            }
            options.agent = agent;
        }

        let wsRemote = new WebSocket(
            wsUrl,
            !protocol ? [] : [protocol],
            options
        );

        wsRemote.on('open', () => {
            setTimeout(() => {
                queueData.forEach(data => {
                    wsRemote.send(data);
                })
                queueData = [];
            }, 1000)
        })
        wsRemote.on('message', (data, isBinary) => {
            let d: PPWebsocketRawData | string = data;
            if (!isBinary) {
                d = data.toString();
            }
            if (this.callbackReceive) {
                d = this.callbackReceive(d);
            }
            ws.send(d);
        })
        wsRemote.on('close', (code, reason) => {
            try {
                ws.close(code, reason);
            } catch (e) {
                ws.close();
            }
        })
        wsRemote.on('error', (err) => {
            console.log(err)
            ws.close();
        })
        wsRemote.on('ping', (data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping(data);
            }
        })
        wsRemote.on('pong', (data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.pong(data);
            }
        })

        ws.on('message', (data, isBinary) => {
            let d: PPWebsocketRawData | string = data;
            if (!isBinary) {
                d = data.toString();
            }
            if (this.callbackSend) {
                d = this.callbackSend(d);
            }
            if (wsRemote.readyState !== WebSocket.OPEN) {
                queueData.push(d);
            } else {
                wsRemote.send(d)
            }
        })
        ws.on('close', (code, reason) => {
            try {
                wsRemote.close(code, reason);
            } catch (e) {
                wsRemote.close();
            }
        })
        ws.on('error', (err) => {
            wsRemote.close();
        })
        ws.on('ping', (data) => {
            if (wsRemote.readyState === WebSocket.OPEN) {
                wsRemote.ping(data);
            }
        })
        ws.on('pong', (data) => {
            if (wsRemote.readyState === WebSocket.OPEN) {
                wsRemote.pong(data);
            }
        })
    }

    private rewriteHeaders(request: PPIncomingMessage) {
        if (this.forwardDst) {
            const url = Url.parse(request.url, true);
            const headers = request.headers;
            headers['host'] = url.hostname;
        }
    }

}