async page => {
  const results=[];
  for(const width of [1440,520,390]) {
    await page.setViewportSize({width,height:1000});
    for(const scale of [1,2]) {
      await page.evaluate(scale=>{document.documentElement.style.fontSize=`${scale*16}px`;},scale);
      await page.getByRole('region',{name:'Multitrack arranger'}).scrollIntoViewIfNeeded();
      results.push(await page.evaluate(async ()=>{
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const viewport=document.querySelector('[data-arranger-viewport]');
        const header=document.querySelector('[data-clip-lane]').firstElementChild;
        const headerWidth=header.getBoundingClientRect().width;
        if(headerWidth>viewport.clientWidth/2)throw Error('Sticky header covers the timeline');
        return {kind:'layout',width:innerWidth,textScale:parseFloat(getComputedStyle(document.documentElement).fontSize)/16,
          scrollWidth:document.documentElement.scrollWidth,viewportWidth:viewport.clientWidth,headerWidth};
      }));
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{document.documentElement.style.fontSize='16px';});
  for(const expanded of [false,true]) {
    const expandedHeaders=page.locator('[data-clip-lane][data-expanded="true"] > div:first-child > button');
    while(await expandedHeaders.count())await expandedHeaders.first().click();
    if(expanded)await page.getByRole('button',{name:'▸ Warm Lead',exact:true}).click();
    for(const beats of [16,16000]) {
      results.push(await page.evaluate(async ({beats,expanded})=>{
        const app=window.__clipTest.store;
        const next=structuredClone(app.getState().sequencer);
        next.clipArrangement.end=beats*20160;
        for(const lane of next.clipArrangement.lanes) {lane.cycleTicks=null;lane.clips[0].mode='loop';lane.clips[0].length=beats*20160;}
        const start=performance.now();app.setState({sequencer:next});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return {kind:'density',beats,expanded,settleMs:performance.now()-start,nodes:document.querySelectorAll('*').length};
      },{beats,expanded}));
    }
  }
  return results;
}
