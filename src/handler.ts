import {PmsServerRequest, PmsServerResponse} from "./server";
import nodeFetch, {RequestInit} from "node-fetch";

export type PmsServerCallbackHandler = (request: PmsServerRequest, response: PmsServerResponse) => Promise<void> | void;

export abstract class PmsServerHandler {
    abstract handle(request: PmsServerRequest, response: PmsServerResponse): Promise<void> | void;
}

export class PmsServerPassThroughHandler extends PmsServerHandler {

    constructor(
        private callback?: (buffer: Buffer) => Promise<Buffer> | Buffer,
        private compress: boolean = true,
    ) {
        super();
    }

    async handle(req: PmsServerRequest, res: PmsServerResponse) {
        const init: RequestInit = {
            compress: this.compress,
            headers: <any>req.headers,
            method: req.method,
            body: req.method === 'GET' || req.method === 'HEAD' ? null : req
        }
        const forwardResponse = await nodeFetch(req.url, init)
            .catch(e => {
                res.status(500).end();
                return null
            });
        if (!forwardResponse) {
            return
        }
        const forwardResponseHeaders = forwardResponse.headers.raw();
        if (this.compress) {
            delete forwardResponseHeaders['content-encoding'];
        }
        if (this.callback) {
            const result = await forwardResponse.buffer();
            const r = await this.callback(result);
            forwardResponseHeaders['content-length'] = r.length;
            res.writeHead(forwardResponse.status, forwardResponseHeaders);
            res.write(r);
            res.end()
        } else {
            res.writeHead(forwardResponse.status, forwardResponseHeaders);
            forwardResponse.body.pipe(res);
        }
    }
}