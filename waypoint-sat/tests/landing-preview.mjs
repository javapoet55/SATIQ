// Real static routing, no production database or LLM calls.
import {createApp} from '../server/app.mjs';
const app=createApp({database:{health:async()=>{}},production:false});
app.listen(5192,'127.0.0.1',()=>console.log('Landing integration preview: http://127.0.0.1:5192'));
