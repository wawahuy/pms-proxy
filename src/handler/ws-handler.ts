import {MayBePromise} from "../types";
import {PPIncomingMessage} from "../server/ws";
import WebSocket from "ws";

export type PPCallbackWsHandler = (request: PPIncomingMessage, ws: WebSocket.WebSocket) => MayBePromise<void>;

export abstract class PPWsHandler {
    abstract handle(request: PPIncomingMessage, ws: WebSocket.WebSocket): MayBePromise<void>;
}


export class PPPassThroughWsHandler extends PPWsHandler {
    private callbackSend: (data: any) => any;
    private callbackReceive: (data: WebSocket.RawData) => any;

    injectSend(callback: (data: any) => any) {
        this.callbackSend = callback;
    }

    injectReceive(callback: (data: WebSocket.RawData) => any) {
        this.callbackReceive = callback;
    }

    handle(request: PPIncomingMessage, ws: WebSocket.WebSocket): MayBePromise<void> {
        let queueData: any[] = [];
        let wsRemote = new WebSocket(request.url, { headers: request.headers });

        wsRemote.on('open', () => {
            queueData.forEach(data => {
                wsRemote.send(data);
            })
            queueData = [];
        })
        wsRemote.on('message', (data) => {
            if (this.callbackReceive) {
                data = this.callbackReceive(data);
            }
            ws.send(data);
        })
        wsRemote.on('close', (code, reason) => {
            ws.close(code, reason);
        })
        wsRemote.on('error', (err) => {
            ws.close();
        })

        ws.on('message', data => {
            if (this.callbackSend) {
                data = this.callbackSend(data);
            }
            if (wsRemote.readyState !== WebSocket.OPEN) {
                queueData.push(data);
            } else {
                wsRemote.send(data)
            }
        })
        ws.on('close', (code, reason) => {
            wsRemote.close(code, reason);
        })
        ws.on('error', (err) => {
            wsRemote.close();
        })
    }

}