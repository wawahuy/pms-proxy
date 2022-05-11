import * as forge from 'node-forge';
import * as fs from "fs";
import { v4 as uuid } from "uuid";
import * as buffer from "buffer";

/**
 *  refer
 *  https://github.com/httptoolkit/mockttp/blob/549f1826059847c4bd81af9a18a45ca46253d7ab/src/util/tls.ts#L95
 *
 */

export type PPCaOptions = PPCaFileOptions | PPCaPathOptions;

export type PPCaFileOptions = {
    key: string;
    cert: string;
    keyLength?: number;
};

export type PPCaPathOptions = {
    keyPath: string;
    certPath: string;
    keyLength?: number;
}

export type PPGeneratedCertificate = {
    key: string,
    cert: string,
    ca: string
};

// We share a single keypair across all certificates in this process, and
// instantiate it once when the first CA is created, because it can be
// expensive (depending on the key length).
// This would be a terrible idea for a real server, but for a mock server
// it's ok - if anybody can steal this, they can steal the CA cert anyway.
let KEY_PAIR: {
    publicKey: forge.pki.rsa.PublicKey,
    privateKey: forge.pki.rsa.PrivateKey,
    length: number
} | undefined;

export class PPCa {
    private caCert: forge.pki.Certificate;
    private caKey: forge.pki.PrivateKey;
    private certCache: { [domain: string]: PPGeneratedCertificate };

    constructor(option: PPCaOptions) {
        this.certCache = {};
        this.initCA(option);
    }

    private initCA(options: PPCaOptions) {
        let httpsOptions: PPCaFileOptions;
        if ((<any>options).key && (<any>options).cert) {
            httpsOptions = <PPCaFileOptions> options;
        }
        else if ((<any>options).keyPath && (<any>options).certPath) {
            let pathOptions = <PPCaPathOptions> options;
            httpsOptions = {
                cert: fs.readFileSync(pathOptions.certPath, 'utf8'),
                key: fs.readFileSync(pathOptions.keyPath, 'utf8'),
                keyLength: options.keyLength
            }
        }
        else {
            throw new Error('Unrecognized https options: you need to provide either a keyPath & certPath, or a key & cert.')
        }

        const keyLength = httpsOptions.keyLength || 2048;
        this.caKey = forge.pki.privateKeyFromPem(httpsOptions.key);
        this.caCert = forge.pki.certificateFromPem(httpsOptions.cert);
        this.certCache = {};

        if (!KEY_PAIR || KEY_PAIR.length < keyLength) {
            // If we have no key, or not a long enough one, generate one.
            KEY_PAIR = Object.assign(
                forge.pki.rsa.generateKeyPair(keyLength),
                { length: keyLength }
            );
        }
    }

    generateCertificate(domain: string): PPGeneratedCertificate {
        // TODO: Expire domains from the cache? Based on their actual expiry?
        if (this.certCache[domain]) return this.certCache[domain];

        let cert = forge.pki.createCertificate();

        cert.publicKey = KEY_PAIR!.publicKey;
        cert.serialNumber = uuid().replace(/-/g, '');

        cert.validity.notBefore = new Date();
        // Make it valid for the last 24h - helps in cases where clocks slightly disagree.
        cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);

        cert.validity.notAfter = new Date();
        // Valid for the next year by default. TODO: Shorten (and expire the cache) automatically.
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

        cert.setSubject([
            { name: 'commonName', value: domain },
            { name: 'organizationName', value: 'PMS CA' }
        ]);
        cert.setIssuer(this.caCert.subject.attributes);

        cert.setExtensions([{
            name: 'keyUsage',
            keyCertSign: true,
            digitalSignature: true,
            nonRepudiation: true,
            keyEncipherment: true,
            dataEncipherment: true
        }, {
            name: 'subjectAltName',
            altNames: [{
                type: 2,
                value: domain
            }]
        }]);

        cert.sign(this.caKey, forge.md.sha256.create());

        const generatedCertificate = {
            key: forge.pki.privateKeyToPem(KEY_PAIR!.privateKey),
            cert: forge.pki.certificateToPem(cert),
            ca: forge.pki.certificateToPem(this.caCert)
        };

        this.certCache[domain] = generatedCertificate;
        return generatedCertificate;
    }

    /**
     * Generate a CA certificate for mocking HTTPS.
     *
     * Returns a promise, for an object with key and cert properties,
     * containing the generated private key and certificate in PEM format.
     *
     * These can be saved to disk, and their paths passed
     * as HTTPS options to a Mockttp server.
     */
     static async generateCACertificate(options: { commonName?: string, bits?: number } = {}) {
        if (!options.commonName) {
            options.commonName = 'PMS CA';
        }

        if (!options.bits) {
            options.bits = 2048;
        }

        const keyPair = await new Promise<forge.pki.rsa.KeyPair>((resolve, reject) => {
            forge.pki.rsa.generateKeyPair({ bits: options.bits }, (error, keyPair) => {
                if (error) reject(error);
                else resolve(keyPair);
            });
        });

        const cert = forge.pki.createCertificate();
        cert.publicKey = keyPair.publicKey;
        cert.serialNumber = uuid().replace(/-/g, '');

        cert.validity.notBefore = new Date();
        // Make it valid for the last 24h - helps in cases where clocks slightly disagree
        cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);

        cert.validity.notAfter = new Date();
        // Valid for the next year by default.
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

        cert.setSubject([{ name: 'commonName', value: options.commonName }]);

        cert.setExtensions([{
            name: 'basicConstraints',
            cA: true
        }]);

        // Self-issued too
        cert.setIssuer(cert.subject.attributes);

        // Self-sign the certificate - we're the root
        cert.sign(keyPair.privateKey, forge.md.sha256.create());

        return {
            key: forge.pki.privateKeyToPem(keyPair.privateKey),
            cert: forge.pki.certificateToPem(cert)
        };
    }

    static generateSPKIFingerprint(certPem: string | Buffer) {
        let cert = forge.pki.certificateFromPem(certPem.toString('utf8'));
        return forge.util.encode64(
            forge.pki.getPublicKeyFingerprint(cert.publicKey, {
                type: 'SubjectPublicKeyInfo',
                md: forge.md.sha256.create(),
                encoding: 'binary'
            })
        );
    }
}