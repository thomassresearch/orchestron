() => {
 const t=window.t07,d=t.diagnostics,c=t.connections.at(-1);
 return {seconds:(performance.now()-t.startedAt)/1000,count:d.length,last:d.at(-1),
  minQueue:Math.min(...d.map(x=>x.queuedFrames)),maxRatio:Math.max(...d.map(x=>x.renderTimeRatio)),
  errors:t.errors,frontendError:t.store.getState().error,ring:[...c.state]};
}
