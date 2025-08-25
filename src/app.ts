import express,{Application} from 'express';
import {Database } from './connection/db/dbConnection'
import http from 'http';
import { serverConfig } from './config/server';
import { expressConfig } from './config/express.config';
import { allMain } from './routes';


const app: Application = express();
const server = http.createServer(app);

//database connection
Database.init()

app.get('/', (req, res) => {
  res.send(' Server is running...');
});
expressConfig.configure(app)


allMain.route(app)

const config= new serverConfig(server)
config.start();