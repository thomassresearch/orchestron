async page => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{document.documentElement.style.fontSize='32px';document.documentElement.style.scrollbarGutter='stable';});
  const results=[];
  for(const language of ['english','german','french','spanish']) {
    await page.evaluate(language=>window.__clipTest.store.getState().setGuiLanguage(language),language);
    const trigger=page.locator('[data-transpose-target]').first();
    await trigger.scrollIntoViewIfNeeded();
    const bounds=await trigger.boundingBox();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.getByRole('dialog').waitFor();
    const tree=await cdp.send('Accessibility.getFullAXTree');
    const controls=tree.nodes.filter(n=>!n.ignored&&['button','textbox','spinbutton','combobox','dialog'].includes(n.role?.value));
    const unnamed=controls.filter(n=>!n.name?.value).map(n=>({role:n.role.value,id:n.nodeId}));
    const layout=await page.getByRole('dialog').evaluate(d=>({coarse:matchMedia('(pointer: coarse)').matches,viewport:innerWidth,page:document.documentElement.scrollWidth,dialogWidth:d.getBoundingClientRect().width,client:d.clientWidth,scroll:d.scrollWidth}));
    await page.keyboard.press('Escape');
    const focusReturned=await trigger.evaluate(n=>n===document.activeElement);
    if(unnamed.length||!focusReturned||layout.page>layout.viewport||layout.scroll>layout.client+1)throw Error(JSON.stringify({language,layout,unnamed,focusReturned}));
    results.push({language,layout,visibleAccessibleControls:controls.length,unnamed,focusReturned,touchOpenedDialog:true});
  }
  await page.evaluate(()=>window.__clipTest.store.getState().setGuiLanguage('english'));
  return results;
}
