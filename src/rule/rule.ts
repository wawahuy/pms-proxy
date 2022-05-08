import {PPServerRequest, PPServerResponse} from "../server/server";
import {PPCallbackHandler, PPHandler} from "../handler/handler";
import {MayBePromise} from "../types";

export type PPRuleMatch = (req: PPServerRequest) => MayBePromise<boolean>;

export type PPRuleValue = string | string | RegExp | RegExp[] | ((value: string) => boolean);

export class PPRule {
    private listMatch: PPRuleMatch[] = [];

    constructor(
        private handler?: PPCallbackHandler | PPHandler
    ) {
    }

    handle(req: PPServerRequest, res: PPServerResponse) {
        if (this.handler instanceof PPHandler) {
            return this.handler.handle(req, res);
        } else if(typeof this.handler === 'function') {
            return this.handler(req, res);
        } else {
            console.error('No handler');
        }
    }

    match(callback: PPRuleMatch){
        this.listMatch.push(callback);
        return this;
    }

    host(host: PPRuleValue) {
        return this.match(req => {
            return this.compare(req.hostname, host);
        })
    }

    url(url: PPRuleValue) {
        return this.match(req => {
            return this.compare(req.url, url);
        })
    }

    body(key: string, value: PPRuleValue) {
        return this.match(req => {
            return this.compare(req.body?.[key], value);
        })
    }

    query(key: string, value: PPRuleValue) {
        return this.match(req => {
            return this.compare(req.query?.[key]?.toString(), value);
        })
    }

    header(key: string, value: PPRuleValue) {
        return this.match(req => {
            return this.compare(req.headers?.[key]?.toString(), value);
        })
    }

    setHandler(handler: PPCallbackHandler | PPHandler) {
        this.handler = handler;
    }

    async test(req: PPServerRequest) {
        for(let match of this.listMatch) {
            if (!await match(req)) {
                return false;
            }
        }
        return true;
    }

    private compare(a: string, b: PPRuleValue) {
        if (typeof b === 'string') {
            return a === b;
        } else if(typeof b === 'function') {
            return b(a);
        } else if (b instanceof RegExp) {
            return a && a.match(b);
        } else if (b instanceof Array) {
            return b.some(item => this.compare(a, item));
        }
        return false;
    }
}