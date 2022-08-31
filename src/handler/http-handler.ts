import {PPServerRequest, PPServerResponse} from "../server/server";
import nodeFetch, {RequestInit} from "node-fetch";
import {MayBePromise} from "../types";
import http from "http";
import express from "express";
import AbortControllerLib from "abort-controller";
import {del} from "request";
import {SocksProxyAgent} from "socks-proxy-agent";
const AbortController = globalThis.AbortController || AbortControllerLib;

export type PPCallbackHttpHandler = (request: PPServerRequest, response: PPServerResponse) => MayBePromise<void>;

export abstract class PPHttpHandler {
    abstract handle(request: PPServerRequest, response: PPServerResponse): MayBePromise<void>;
}

export const createAppHttpHandler = () => express();

export class PPPassThroughHttpHandler extends PPHttpHandler {
    public static agents: SocksProxyAgent[];
    public static agentCurrent = 0;

    callbackInjectBuffer: (req: PPServerRequest, buffer: Buffer) => MayBePromise<{
        data: Buffer | string,
        headers?: http.IncomingHttpHeaders
    }>;

    constructor(
        private compress: boolean = true,
        private removeCached: boolean = false,
    ) {
        super();
    }

    injectBuffer(callback: Required<PPPassThroughHttpHandler>['callbackInjectBuffer']) {
        this.callbackInjectBuffer = callback;
    }

    async handle(req: PPServerRequest, res: PPServerResponse) {
        const abort = new AbortController();

        // custom headers
        const headers = <any>req.headers;
        if (this.removeCached) {
            delete headers['if-modified-since'];
            delete headers['if-none-match'];
        }

        const init: RequestInit = {
            compress: this.compress,
            headers,
            method: req.method,
            body: req.method === 'GET' || req.method === 'HEAD'
                ? null
                : (req.readableEnded ? JSON.stringify(req.body) : req),
            redirect: "manual",
            signal: abort.signal
        }

        const agents = PPPassThroughHttpHandler.agents;
        if (agents?.length) {
            const agent = agents[PPPassThroughHttpHandler.agentCurrent++];
            if (PPPassThroughHttpHandler.agentCurrent >= agents.length) {
                PPPassThroughHttpHandler.agentCurrent = 0;
            }
            init.agent = agent;
        }

        const forwardResponse = await nodeFetch(req.url, init)
            .catch(e => {
                console.log(e);
                res.status(500).end();
                return null
            });
        if (!forwardResponse) {
            return
        }

        forwardResponse.body.on("error", (err) => {
            console.log(err)
            res.status(500).end();
        })

        req.on('close', () => {
            if (!res.writableEnded) {
                abort.abort()
            }
        })

        let forwardResponseHeaders = forwardResponse.headers.raw();
        if (this.compress) {
            delete forwardResponseHeaders['content-encoding'];
        }

        if (this.callbackInjectBuffer) {
            const buffer = await forwardResponse.buffer()
                .catch(r => null);

            if (!buffer) {
                return;
            }
            const result = await this.callbackInjectBuffer(req, buffer);
            if (result.headers) {
                forwardResponseHeaders = Object.assign(forwardResponseHeaders, result.headers);
            }

            let data = result.data;
            if (!(data instanceof Buffer)) {
                data = Buffer.from(data);
            }
            forwardResponseHeaders['content-length'] = data.length;
            res.writeHead(forwardResponse.status, forwardResponseHeaders);
            res.write(data);
            res.end()
        } else {
            res.writeHead(forwardResponse.status, forwardResponseHeaders);
            forwardResponse.body.pipe(res);
        }
    }
}