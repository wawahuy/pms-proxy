import {PmsServerProxy} from "../src/server";

describe('test', () => {
    const server = new PmsServerProxy();

    it('test', async () => {
        await expect(server.listen(1234)).resolves.toEqual(false);
    })
})