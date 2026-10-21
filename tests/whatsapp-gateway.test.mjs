import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWhatsappPhone,normalizeGatewayUrl,pairingDigits,validAuthMode} from '../apps/client/js/whatsapp-gateway.js';

test('WhatsApp strict state names',()=>{
 for(const mode of ['qr','phone_input','pairing_code','connected'])assert.equal(validAuthMode(mode),true);
 for(const mode of ['','loading','sharing','success'])assert.equal(validAuthMode(mode),false);
});
test('phone and pairing validations',()=>{
 assert.equal(normalizeWhatsappPhone('777123456'),'967777123456');
 assert.equal(normalizeWhatsappPhone('+967 777 123 456'),'967777123456');
 assert.equal(normalizeWhatsappPhone('0777123456'),'967777123456');
 assert.throws(()=>normalizeWhatsappPhone('12345'));
 assert.deepEqual(pairingDigits('ABCD-EF12'),['A','B','C','D','E','F','1','2']);
 assert.deepEqual(pairingDigits('123'),[]);
});
test('gateway URL requires HTTPS except localhost',()=>{
 assert.equal(normalizeGatewayUrl('https://example.com/'),'https://example.com');
 assert.equal(normalizeGatewayUrl('http://localhost:5059/'),'http://localhost:5059');
 assert.throws(()=>normalizeGatewayUrl('http://example.com'));
 assert.throws(()=>normalizeGatewayUrl('https://username:password@example.com'));
 assert.throws(()=>normalizeGatewayUrl('https://example.com/path'));
});
