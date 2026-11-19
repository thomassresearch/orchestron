import { generateMarkov } from "./markov";
self.onmessage = ({ data }: MessageEvent<Parameters<typeof generateMarkov>>) => {
  try {
    self.postMessage({ events: generateMarkov(...data) });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
