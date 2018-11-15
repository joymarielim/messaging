'use strict';

const handler = require('./handler');

describe('test handler', async ()=>{
    test('test publishMessage', async ()=>{
        let response = await handler.publishMessage({}, {});
        expect(response).not.toBeNull();
    } );
} );
