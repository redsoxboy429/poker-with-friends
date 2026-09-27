// Local production run: the built client and the socket server on one port (default 3001),
// reachable from phones on the same Wi-Fi. Run `npm run build` first.
process.env.NODE_ENV = 'production';
process.env.PORT ??= '3001';
await import('../server/dist/index.js');
