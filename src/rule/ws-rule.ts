import {PPRule} from "./rule";
import {PPIncomingMessage} from "../server/ws";
import {PPCallbackWsHandler, PPWsHandler} from "../handler/ws-handler";
import WebSocket from "ws";

export class PPWsRule extends PPRule<PPIncomingMessage, PPWsHandler | PPCallbackWsHandler> {
    handle(req: PPIncomingMessage, ws: WebSocket.WebSocket) {
        if (this.handler instanceof PPWsHandler) {
            return this.handler.handle(req, ws);
        } else if(typeof this.handler === 'function') {
            return this.handler(req, ws);
        } else {
            console.error('No handler');
        }
    }
}