// Exercises the monitor's real HTTP path against a local server: status codes,
// redirects, slowness, and the all-failed guard. No external DNS needed.
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.url === '/ok')       { res.writeHead(200, {'Content-Type':'text/html'}); return res.end('<h1>fine</h1>'); }
  if (req.url === '/500')      { res.writeHead(500); return res.end('boom'); }
  if (req.url === '/404')      { res.writeHead(404); return res.end('nope'); }
  if (req.url === '/hop')      { res.writeHead(301, {Location:'/ok'}); return res.end(); }
  if (req.url === '/loop')     { res.writeHead(302, {Location:'/loop'}); return res.end(); }
  if (req.url === '/slow')     { return setTimeout(()=>{ res.writeHead(200); res.end('late'); }, 6000); }
  res.writeHead(200); res.end('root');
});

server.listen(4111, '127.0.0.1', async () => {
  const dbPath = require.resolve('../lib/db');
  const writes = [];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    pool: { query: async () => ({rows:[]}), end: async () => {} },
    init: async () => {},
    list: async () => ([
      { id:'ok',   name:'Healthy',       url:'http://127.0.0.1:4111/ok',   status:'ok', issues:[] },
      { id:'500',  name:'Server error',  url:'http://127.0.0.1:4111/500',  status:'ok', issues:[] },
      { id:'404',  name:'Missing page',  url:'http://127.0.0.1:4111/404',  status:'ok', issues:[] },
      { id:'hop',  name:'Redirects',     url:'http://127.0.0.1:4111/hop',  status:'ok', issues:[] },
      { id:'loop', name:'Redirect loop', url:'http://127.0.0.1:4111/loop', status:'ok', issues:[] },
      { id:'slow', name:'Slow site',     url:'http://127.0.0.1:4111/slow', status:'ok', issues:[] },
      { id:'heal', name:'Recovering',    url:'http://127.0.0.1:4111/ok',   status:'crit',
        issues:[{text:'was down', severity:'crit', auto:true, resolved:false}] },
      { id:'human',name:'Human issue',   url:'http://127.0.0.1:4111/ok',   status:'warn',
        issues:[{text:'client wants new photos', severity:'warn', auto:false, resolved:false}] },
      { id:'dead', name:'Unreachable',   url:'http://127.0.0.1:4111X/bad', status:'ok', issues:[] }
    ]),
    patch: async (c,id,f) => { writes.push({id,f}); },
    logActivity: async () => {}
  }};

  require('../cron/check-sites.js');

  setTimeout(() => {
    const by = Object.fromEntries(writes.map(w => [w.id, w.f]));
    let pass=0, fail=0;
    const check=(n,c,d)=>{ c?(pass++,console.log('  PASS  '+n)):(fail++,console.log('  FAIL  '+n+(d?'  → '+d:''))); };

    check('200 is healthy',            by.ok   && by.ok.autoStatus==='ok'   && by.ok.status==='ok', JSON.stringify(by.ok));
    check('500 is critical',           by['500'] && by['500'].autoStatus==='crit' && by['500'].status==='crit');
    check('404 is critical',           by['404'] && by['404'].autoStatus==='crit');
    check('redirects are followed',    by.hop  && by.hop.autoStatus==='ok' && by.hop.httpStatus===200);
    check('redirect loop is caught',   by.loop && by.loop.autoStatus==='crit' && /loop/i.test(by.loop.autoNote||''), by.loop&&by.loop.autoNote);
    check('slow site is flagged',      by.slow && by.slow.autoStatus==='warn' && /slow/i.test(by.slow.autoNote||''), by.slow&&by.slow.autoNote);
    check('response time recorded',    by.ok && by.ok.responseMs >= 0 && typeof by.ok.responseMs === 'number');
    check('down site opens an issue',  by['500'].issues && by['500'].issues[0].auto===true && by['500'].issues[0].by==='Monitor');
    check('recovery closes the monitor issue',
      by.heal && by.heal.status==='ok' && by.heal.issues && by.heal.issues[0].resolved===true);
    check('recovery leaves a human issue alone',
      by.human && by.human.status===undefined && (!by.human.issues || by.human.issues[0].resolved!==true),
      'status=' + (by.human&&by.human.status));
    check('unreachable host is critical', by.dead && by.dead.autoStatus==='crit');
    check('mixed results are still written (guard did not misfire)', writes.length===9, writes.length+' writes');

    console.log('\n  '+pass+' passed, '+fail+' failed');
    server.close();
    process.exit(fail?1:0);
  }, 12000);
});
