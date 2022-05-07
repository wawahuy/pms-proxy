import {PmsServerProxy} from "./server";

export {
    PmsServerProxy
}

import request from 'request';
import path from "path";
import fs from "fs";
import {PmsServerPassThroughHandler} from "./handler";

const s = new PmsServerProxy({
    https: {
        certPath: path.join(__dirname, '../certs/rootCA.pem'),
        keyPath: path.join(__dirname, '../certs/rootCA.key')
    }
});
s.listen(1234).then(r => {
    s.addRule()
        .host([/google\.com/g])
        .setHandler(new PmsServerPassThroughHandler( buffer => {
            return Buffer.from(buffer.toString() + "<script>alert(1)</script>");
        }))

    request('https://google.com/test?a=1', {
        proxy: 'http://localhost:1234',
        ca: fs.readFileSync(path.join(__dirname, '../certs/rootCA.pem'))
     }, (err, res) => {
        if (!!err) {
            console.log(err.name);
            return;
        }
        console.log(res.body.length);
    })
});