import { handleBuildMessage } from './workerCore.js';

self.onmessage = (e) => handleBuildMessage(e.data, (m, transfer) => self.postMessage(m, transfer || []));
