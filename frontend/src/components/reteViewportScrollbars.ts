/** Scroll coordinates use scaled graph pixels, before the Rete pan translation. */
export function graphScrollAxis(viewportSize: number, translation: number, bounds: { min: number; max: number } | null) {
  const position = -translation;
  const min = bounds ? Math.floor(Math.min(bounds.min - 48, position)) : position;
  const max = bounds ? Math.ceil(Math.max(bounds.max + 48, position + viewportSize)) : position + viewportSize;
  return { min, size: Math.max(viewportSize, max - min), offset: position - min };
}

interface ViewportArea {
  transform: { x: number; y: number; k: number };
  content: { holder: HTMLElement };
  translate: (x: number, y: number) => Promise<unknown>;
}

export function createReteViewportScrollbars(
  area: ViewportArea,
  viewport: HTMLElement,
  horizontal: HTMLElement,
  vertical: HTMLElement
) {
  let disposed = false;
  let synchronized = false;
  let frame = 0;
  let translating = false;
  let pendingX: number | null = null;
  let pendingY: number | null = null;
  let xAxis = graphScrollAxis(0, 0, null);
  let yAxis = graphScrollAxis(0, 0, null);
  let expectedX = 0;
  let expectedY = 0;
  const observed = new Set<Element>();
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(refresh);
  };
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(viewport);

  function refresh() {
    frame = 0;
    if (disposed || translating || !viewport.clientWidth || !viewport.clientHeight) return;
    const viewportRect = viewport.getBoundingClientRect();
    const elements = new Set(area.content.holder.querySelectorAll('[data-testid="node"], [data-node-actions], .vs-case-region'));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const element of elements) {
      if (!observed.has(element)) { resizeObserver.observe(element); observed.add(element); }
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      minX = Math.min(minX, rect.left - viewportRect.left - area.transform.x);
      minY = Math.min(minY, rect.top - viewportRect.top - area.transform.y);
      maxX = Math.max(maxX, rect.right - viewportRect.left - area.transform.x);
      maxY = Math.max(maxY, rect.bottom - viewportRect.top - area.transform.y);
    }
    for (const element of observed) {
      if (!elements.has(element)) { resizeObserver.unobserve(element); observed.delete(element); }
    }
    xAxis = graphScrollAxis(viewport.clientWidth, area.transform.x, Number.isFinite(minX) ? { min: minX, max: maxX } : null);
    yAxis = graphScrollAxis(viewport.clientHeight, area.transform.y, Number.isFinite(minY) ? { min: minY, max: maxY } : null);
    (horizontal.firstElementChild as HTMLElement).style.width = `${xAxis.size}px`;
    (vertical.firstElementChild as HTMLElement).style.height = `${yAxis.size}px`;
    horizontal.scrollLeft = xAxis.offset;
    vertical.scrollTop = yAxis.offset;
    // Native scroll events are asynchronous and offsets may be rounded by the browser.
    expectedX = horizontal.scrollLeft;
    expectedY = vertical.scrollTop;
    synchronized = true;
  }

  async function translate() {
    if (translating || disposed) return;
    translating = true;
    try {
      while (!disposed && (pendingX !== null || pendingY !== null)) {
        const x = pendingX ?? area.transform.x;
        const y = pendingY ?? area.transform.y;
        pendingX = pendingY = null;
        await area.translate(x, y);
      }
    } finally {
      translating = false;
      schedule();
    }
  }
  const scrollX = () => {
    if (disposed || !synchronized || Math.abs(horizontal.scrollLeft - expectedX) < 0.5) return;
    expectedX = horizontal.scrollLeft;
    pendingX = -xAxis.min - horizontal.scrollLeft;
    void translate();
  };
  const scrollY = () => {
    if (disposed || !synchronized || Math.abs(vertical.scrollTop - expectedY) < 0.5) return;
    expectedY = vertical.scrollTop;
    pendingY = -yAxis.min - vertical.scrollTop;
    void translate();
  };
  horizontal.addEventListener("scroll", scrollX);
  vertical.addEventListener("scroll", scrollY);
  // Includes node movement, zoom/pan transforms, and resized control-flow frames.
  const mutations = new MutationObserver(schedule);
  mutations.observe(area.content.holder, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  schedule();
  return {
    refresh: schedule,
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resizeObserver.disconnect();
      horizontal.removeEventListener("scroll", scrollX);
      vertical.removeEventListener("scroll", scrollY);
    }
  };
}
