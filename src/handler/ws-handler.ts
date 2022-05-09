import {MayBePromise} from "../types";
import {PPIncomingMessage, PPWebsocket, PPWebsocketRawData} from "../server/ws";
import WebSocket from "ws";
import * as Url from "url";

export type PPCallbackWsHandler = (request: PPIncomingMessage, ws: WebSocket.WebSocket) => MayBePromise<void>;

export abstract class PPWsHandler {
    abstract handle(request: PPIncomingMessage, ws: WebSocket.WebSocket): MayBePromise<void>;
}


export class PPPassThroughWsHandler extends PPWsHandler {
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
        let wsRemote = new WebSocket(wsUrl, { headers: request.headers });

        wsRemote.on('open', () => {
            queueData.forEach(data => {
                wsRemote.send(data);
            })
            queueData = [];
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
            ws.close();
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
    }

    private rewriteHeaders(request: PPIncomingMessage) {
        if (this.forwardDst) {
            const url = Url.parse(request.url, true);
            const headers = request.headers;
            headers['host'] = url.hostname;
        }
    }

}