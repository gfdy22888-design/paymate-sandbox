'use strict';
// A temporary localhost landing page for API-only Sandbox verification. It does
// not read cookies, authorize an order, expose keys, or infer approval from a URL.
const http = require('node:http');
const server = http.createServer((req,res) => {
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>CheckoutLab Sandbox verification</title><body style="font-family:system-ui;max-width:720px;margin:60px auto"><h1>Sandbox verification return</h1><p>This is a temporary landing page for an API-only test, not a payment receipt.</p><p>Return to the chat after completing buyer approval. The server must verify the approval with the official Sandbox API before any test-funds capture.</p><p>No production payment is involved. A redirect alone is not proof of approval.</p></body></html>');
});
server.listen(19775,'127.0.0.1',()=>console.log('Sandbox verification landing page ready on loopback.'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
