import { loadConfig } from './config.js';
import { createLinkService } from './lib/links.js';
import { createApp } from './app.js';

const config = loadConfig();
const links = createLinkService(config);
const { app, ready } = createApp(config, links);

await ready();
const port = config.APP_PORT;
await app.listen({ port, host: '0.0.0.0' });

