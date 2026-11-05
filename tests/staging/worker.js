// Verification entry point only; never used by the production wrangler.jsonc.
import app,{cleanup} from '../../src/index.js';
import {hash,equal} from '../../src/security.js';
export default {
 ...app,
 async fetch(request,env,ctx){
  if(new URL(request.url).pathname==='/api/__verify/cleanup'&&request.method==='POST'){
   const supplied=request.headers.get('authorization')||'';
   if(!env.ADMIN_PASSWORD||!equal(await hash(supplied),await hash('Bearer '+env.ADMIN_PASSWORD)))return new Response('Unauthorized',{status:401});
   await cleanup(env);return Response.json({ok:true});
  }
  return app.fetch(request,env,ctx);
 }
};
