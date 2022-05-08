import {PPRule, PPRuleValue} from "./rule";
import {PPServerRequest, PPServerResponse} from "../server/server";
import {PPCallbackHttpHandler, PPHttpHandler} from "../handler/http-handler";


export class PPHttpRule extends PPRule<PPServerRequest, PPHttpHandler | PPCallbackHttpHandler> {

    body(key: string, value: PPRuleValue) {
        return this.match(req => {
            return this.compare(req.body?.[key], value);
        })
    }

    handle(req: PPServerRequest, res: PPServerResponse) {
        req.query
        if (this.handler instanceof PPHttpHandler) {
            return this.handler.handle(req, res);
        } else if(typeof this.handler === 'function') {
            return this.handler(req, res);
        } else {
            console.error('No handler');
        }
    }
}