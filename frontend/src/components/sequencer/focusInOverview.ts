/** Reveal a launcher row or phrase without scrolling the document or the editor dock. */
export function focusInOverview(node: HTMLElement) {
  node.focus({ preventScroll: true });
  const pane = node.closest<HTMLElement>(".ws-overview");
  if (!pane) return;
  const bounds = pane.getBoundingClientRect(), item = node.getBoundingClientRect();
  const top = bounds.top + pane.clientTop + 4, bottom = bounds.top + pane.clientTop + pane.clientHeight - 4;
  if (item.top < top) pane.scrollTop += item.top - top;
  else if (item.bottom > bottom) pane.scrollTop += item.bottom - bottom;
  const left = bounds.left + pane.clientLeft + 4, right = bounds.left + pane.clientLeft + pane.clientWidth - 4;
  if (item.left < left) pane.scrollLeft += item.left - left;
  else if (item.right > right) pane.scrollLeft += item.right - right;
}
