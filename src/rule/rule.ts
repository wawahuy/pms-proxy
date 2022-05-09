import {MayBePromise} from "../types";
import {ParsedQs} from "qs";

export type PPRuleValue = string | string | RegExp | RegExp[] | ((value: string) => boolean);

interface IMatch {
    hostname: string;
    url: string;
    query: ParsedQs,
    headers: ParsedQs,
}

export class PPRule<TMatch extends IMatch, THandler> {
    protected listMatch: ((req: TMatch) => MayBePromise<boolean>)[] = [];

    constructor(
        protected handler?: THandler
    ) {
    }

    match(callback: (req: TMatch) => MayBePromise<boolean>){
        this.listMatch.push(callback);
        return this;
    }

    any() {
        return this.match(req => true)
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

    then(handler: THandler) {
        this.handler = handler;
    }

    async test(req: TMatch) {
        for(let match of this.listMatch) {
            if (!await match(req)) {
                return false;
            }
        }
        return true;
    }

    protected compare(a: string, b: PPRuleValue) {
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