import { mount } from 'svelte';
import App from './App.svelte';
import { createDemoTransport } from './lib/demo';
import { createHttpTransport } from './lib/http';
import { registerServiceWorker } from './lib/pwa';
import { app } from './lib/state.svelte';
import './styles/app.css';

const transport = __DEMO__ ? createDemoTransport() : createHttpTransport();

mount(App, { target: document.getElementById('app') as HTMLElement });
void app.boot(transport);
registerServiceWorker();
