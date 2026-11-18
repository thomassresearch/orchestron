// Run in the workspace harness with UX Baseline Clip loaded and the engine stopped.
async page => {
  const button = (name, within = page) => within.getByRole("button", { name, exact: true });
  const view = name => button(name).click();
  await view("Mix");
  await button("Start Instruments").click();
  const requests = [];
  const observe = request => {
    if (request.method() !== "GET" && /\/sessions\/[^/]+\/sequencer\//.test(request.url())) requests.push(request.url());
  };
  try {
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState === "running");
    await view("Arrange");
    await button("Play", page.getByRole("region", { name: "Multitrack arranger" })).click();
    await page.waitForFunction(() => {
      const { sequencerRuntime } = window.__workspaceTest.store.getState();
      return sequencerRuntime.arrangerActive && sequencerRuntime.arrangerTransportSubunit > 0;
    });
    const before = await page.evaluate(() => {
      const h = window.__workspaceTest;
      const s = h.store.getState();
      h.commands = [];
      h.originalPost = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function(message, ...args) {
        if (message.type === "sequencer_request") h.commands.push(message.request.type);
        return h.originalPost.call(this, message, ...args);
      };
      return { session: s.activeSessionId, position: s.sequencerRuntime.arrangerTransportSubunit, revision: s.sequencerEditRevision };
    });
    page.on("request", observe);
    for (const name of ["Live", "Mix", "Mix", "Arrange"]) await view(name);
    await page.waitForFunction(position => {
      const runtime = window.__workspaceTest.store.getState().sequencerRuntime;
      return runtime.arrangerActive && runtime.arrangerTransportSubunit > position;
    }, before.position, { timeout: 2500 });
    const after = await page.evaluate(() => {
      const h = window.__workspaceTest, s = h.store.getState();
      return { session: s.activeSessionId, position: s.sequencerRuntime.arrangerTransportSubunit, revision: s.sequencerEditRevision, commands: h.commands };
    });
    if (before.session !== after.session || before.revision !== after.revision || after.commands.length || requests.length) {
      throw Error(JSON.stringify({ before, after, requests }));
    }
    return { startTick: before.position, endTick: after.position, workerCommands: after.commands.length, sequencerWrites: requests.length };
  } finally {
    page.off("request", observe);
    await page.evaluate(() => {
      const h = window.__workspaceTest;
      if (h.originalPost) Worker.prototype.postMessage = h.originalPost;
      delete h.originalPost;
      delete h.commands;
    });
    await view("Mix");
    if (await button("Stop Instruments").isEnabled()) await button("Stop Instruments").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
  }
}
