
import request from 'request';
import path from "path";
import fs from "fs";
import {PmsServerPassThroughHandler} from "./handler";
import {PmsServerProxy} from "./server";

const s = new PmsServerProxy({
    https: {
        certPath: path.join(__dirname, '../certs/rootCA.pem'),
        keyPath: path.join(__dirname, '../certs/rootCA.key')
    }
});
s.listen(1234).then(r => {
    const pass = new PmsServerPassThroughHandler();
    pass.injectBuffer((req, buffer) => {
        return {
            data: buffer.toString() + "<script>alert(1)</script>"
        };
    })

    s.addRule()
        .host([/test-google\.com/g])
        .setHandler(pass);

    // s.addRule()
    //     .match(() => true)
    //     .setHandler((req, res) => {
    //         console.log(req.url);
    //         res.status(200).write('Hello world!');
    //     })

    for (let i of [1,2]) {
        request('https://google.com/test?a=' + i, {
            proxy: 'http://localhost:1234',
            ca: fs.readFileSync(path.join(__dirname, '../certs/rootCA.pem'))
        }, (err, res) => {
            if (!!err) {
                console.log(err.name);
                return;
            }
            console.log(res.body.length);
        })
    }
});