import {Server} from 'http'
import { envConfig } from './env.config';

export class serverConfig {
    private server: Server;

    constructor(server: Server) {
        this.server = server;
    }
         public start() {
        this.server.listen(envConfig.port,()=>{
            console.log(`Server is running on port ${envConfig.port} `);
        })
    }
}

