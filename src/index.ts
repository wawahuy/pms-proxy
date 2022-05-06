import {PmsServerProxy} from "./server";
import request from 'request';
import path from "path";
import fs from "fs";

const s = new PmsServerProxy({
    https: {
        certPath: path.join(__dirname, '../certs/rootCA.pem'),
        keyPath: path.join(__dirname, '../certs/rootCA.key')
    }
});
s.listen(1234).then(r => {
    console.log('started!')

    request('https://google.com/', { 
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
