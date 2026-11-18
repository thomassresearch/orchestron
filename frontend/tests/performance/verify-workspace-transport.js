// Load either milestone 1 fixture, with no loop selection and the engine stopped.
async page => {
  const button = (name, root = page) => root.getByRole("button", { name, exact: true });
  const transport = page.getByRole("group", { name: "Song transport" });
  const position = transport.getByRole("spinbutton", { name: "Position" });
  const play = async () => {
    await button("Play", transport).click();
    await page.waitForFunction(() => {
      const runtime = window.__workspaceTest.store.getState().sequencerRuntime;
      return runtime.arrangerActive && runtime.arrangerTransportSubunit > 0;
    });
  };
  await button("Start Instruments").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState === "running");
  try {
    await play();
    await button("Pause", transport).click();
    // The command acknowledgement can precede already-buffered PCM.
    await page.waitForTimeout(2000);
    const paused = Number(await position.inputValue());
    await page.waitForTimeout(450);
    if (paused <= 0 || Number(await position.inputValue()) !== paused) throw Error("Pause did not hold the song position");
    await play();
    await button("Stop", transport).click();
    await page.waitForTimeout(2500);
    if (Number(await position.inputValue()) !== 0 || await button("Stop", transport).getAttribute("aria-pressed") !== "true") {
      throw Error("Stop lost its reset after the audio queue drained");
    }
    if (!await button("Stop Instruments").isVisible()) throw Error("Song Stop shut down an independently started engine");
    return { paused, stopped: 0 };
  } finally {
    await button("Stop Instruments").click();
  }
}
