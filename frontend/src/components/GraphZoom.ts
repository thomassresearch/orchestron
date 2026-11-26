import { Zoom } from "rete-area-plugin";

const PINCH_SENSITIVITY = 0.5;

/** Rete's wheel and touch gestures use different inputs. Keep the zoom anchored
 * at the cursor or touch midpoint and let two fingers pan at their normal speed. */
export class GraphZoom extends Zoom {
  constructor() {
    super(0.1); // Rete's standard wheel step, also used for double-click.
  }

  protected override wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (!event.deltaY) return;
    const step = this.intensity * (event.ctrlKey ? PINCH_SENSITIVITY : 1);
    const delta = event.deltaY < 0 ? step : -step;
    const { left, top } = this.element.getBoundingClientRect();
    this.onzoom(delta, (left - event.clientX) * delta, (top - event.clientY) * delta, "wheel");
  };

  protected override move = (event: PointerEvent) => {
    const index = this.pointers.findIndex(pointer => pointer.pointerId === event.pointerId);
    if (index < 0) return;
    this.pointers[index] = event;
    if (!this.isTranslating()) return;

    const [first, second] = this.pointers;
    const cx = (first.clientX + second.clientX) / 2;
    const cy = (first.clientY + second.clientY) / 2;
    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    if (this.previous && this.previous.distance > 0) {
      const delta = (distance / this.previous.distance - 1) * PINCH_SENSITIVITY;
      const { left, top } = this.element.getBoundingClientRect();
      const ox = (left - this.previous.cx) * delta + cx - this.previous.cx;
      const oy = (top - this.previous.cy) * delta + cy - this.previous.cy;
      this.onzoom(delta, ox, oy, "touch");
    }
    this.previous = { cx, cy, distance };
  };
}
