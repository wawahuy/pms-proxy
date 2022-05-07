import {PmsServerRequest, PmsServerResponse} from "./server";
import {PmsServerCallbackHandler, PmsServerHandler} from "./handler";

export type PmsProxyRuleMatch = (req: PmsServerRequest) => boolean | Promise<boolean>;

export type PmsProxyRuleValue = string | string | RegExp | RegExp[] | ((value: string) => boolean);

export class PmsProxyRule {
    private listMatch: PmsProxyRuleMatch[] = [];

    constructor(
        private handler?: PmsServerCallbackHandler | PmsServerHandler
    ) {
    }

    async handle(req: PmsServerRequest, res: PmsServerResponse) {
        if (this.handler instanceof PmsServerHandler) {
            return this.handler.handle(req, res);
        } else {
            return this.handler(req, res);
        }
    }

    match(callback: PmsProxyRuleMatch){
        this.listMatch.push(callback);
        return this;
    }

    host(host: PmsProxyRuleValue) {
        return this.match(req => {
            return this.compare(req.hostname, host);
        })
    }

    url(url: PmsProxyRuleValue) {
        return this.match(req => {
            return this.compare(req.url, url);
        })
    }

    body(key: string, value: PmsProxyRuleValue) {
        return this.match(req => {
            return this.compare(req.body?.[key], value);
        })
    }

    query(key: string, value: PmsProxyRuleValue) {
        return this.match(req => {
            return this.compare(req.query?.[key]?.toString(), value);
        })
    }

    header(key: string, value: PmsProxyRuleValue) {
        return this.match(req => {
            return this.compare(req.headers?.[key]?.toString(), value);
        })
    }

    setHandler(handler: PmsServerCallbackHandler | PmsServerHandler) {
        this.handler = handler;
    }

    async test(req: PmsServerRequest) {
        for(let match of this.listMatch) {
            if (!await match(req)) {
                return false;
            }
        }
        return true;
    }

    private compare(a: string, b: PmsProxyRuleValue) {
        if (typeof b === 'string') {
            return a === b;
        } else if (b instanceof RegExp) {
            return a.match(b);
        } else if (b instanceof Array) {
            return b.every(item => this.compare(a, item));
        }
        return true;
    }
}