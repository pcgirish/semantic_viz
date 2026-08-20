import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type ViewBox = { x: number; y: number; w: number; h: number };

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_FACTOR = 1.1;
const DRAG_THRESHOLD = 3;
const PAD = 24;

/** Bounding box of a scene's nodes, padded — the content extent pan/zoom operates on. */
export function sceneBounds(scene: { nodes: Array<{ x: number; y: number; w: number; h: number }> }): ViewBox {
  if (scene.nodes.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const minX = Math.min(...scene.nodes.map((n) => n.x)) - PAD;
  const minY = Math.min(...scene.nodes.map((n) => n.y)) - PAD;
  const maxX = Math.max(...scene.nodes.map((n) => n.x + n.w)) + PAD;
  const maxY = Math.max(...scene.nodes.map((n) => n.y + n.h)) + PAD;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Scale that makes `base` fit inside the scroll viewport. Capped at 1 so a two-tile scene is
 * not blown up to fill a large screen, and clamped to the same bounds the wheel zoom uses.
 * Returns 1 when the viewport has no size yet — on first paint the element is not laid out,
 * and dividing by zero there would yield Infinity and a container of NaN width.
 */
function fitScale(scroll: HTMLDivElement | null, base: ViewBox): number {
  const vw = scroll?.clientWidth ?? 0;
  const vh = scroll?.clientHeight ?? 0;
  if (vw <= 0 || vh <= 0 || base.w <= 0 || base.h <= 0) return 1;
  const fit = Math.min(vw / base.w, vh / base.h, 1);
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit));
}

export type PanZoom = {
  scrollRef: React.RefObject<HTMLDivElement>;
  scale: number;
  renderSize: { w: number; h: number };
  /** True once the current gesture has moved past the drag threshold — lets a host
   *  suppress a click/double-click that was really the end of a pan. */
  didPan: () => boolean;
  handlers: {
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
    onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
    onMouseUp: () => void;
  };
};

/**
 * Wheel-zoom + drag-pan + fit-to-content over a native-scrolling viewport, shared by every
 * canvas-like view (CanvasHost, Flowchart). The viewport scrolls; zoom is a transform on the
 * content's common ancestor, so hosts render two nested layers: an outer `.canvas-extent`
 * sized to `renderSize` (the scrolled extent at the current scale, which is what gives the
 * container real scrollbars) and an inner `.canvas-scale` at raw scene dimensions carrying
 * `transform: scale(scale)` pinned to the top-left, so scene coordinates and scroll offsets
 * stay in the same space.
 */
export function usePanZoom(base: ViewBox): PanZoom {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  // Mirrors scaleRef into render output. The ref stays the source of truth for the wheel
  // handler (which reads it outside React's render cycle); this only drives the transform.
  const [scale, setScale] = useState(1);
  const [renderSize, setRenderSize] = useState({ w: 1, h: 1 });
  const dragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);

  // First paint, or navigating to a different scene (e.g. Back/drill changes the visible unit
  // set): fit the scene to the viewport, otherwise the container keeps the previous scene's
  // size and the new, differently-sized scene renders clipped.
  //
  // A layout effect rather than a render-time assignment, because the fit has to measure the
  // scroll container — during the first render `scrollRef.current` is still null and every
  // dimension would read 0. Effects run after the DOM exists, before the browser paints, so
  // the fitted scale is the first thing the user sees.
  //
  // Keyed on the scene's *bounds*, not its object identity: a fresh scene object is built
  // whenever `edges` is a new array literal, which is every render from a parent that builds
  // it inline — keying on identity would re-fit constantly and discard the user's zoom.
  useLayoutEffect(() => {
    if (base.w === 1 && base.h === 1) return;
    const fit = fitScale(scrollRef.current, base);
    scaleRef.current = fit;
    setScale(fit);
    setRenderSize({ w: base.w * fit, h: base.h * fit });
  }, [base.x, base.y, base.w, base.h]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    // React 17+ attaches wheel listeners as passive, so preventDefault() from a
    // synthetic onWheel handler is silently ignored. Firefox then lets the wheel
    // gesture fall through to native scroll/zoom instead of just running our zoom
    // logic, unlike Safari/Chrome which are more lenient. A native, non-passive
    // listener is required to actually suppress that.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = scroll.getBoundingClientRect();
      const px = e.clientX - rect.left + scroll.scrollLeft;
      const py = e.clientY - rect.top + scroll.scrollTop;

      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaleRef.current * factor));
      const ratio = nextScale / scaleRef.current;
      scaleRef.current = nextScale;
      setScale(nextScale);

      setRenderSize({ w: base.w * nextScale, h: base.h * nextScale });

      // Keep the point under the cursor stationary: it scales by `ratio` in content
      // space, so the scroll offset must grow by the same amount around that point.
      scroll.scrollLeft = px * ratio - (e.clientX - rect.left);
      scroll.scrollTop = py * ratio - (e.clientY - rect.top);
    };

    scroll.addEventListener("wheel", onWheel, { passive: false });
    return () => scroll.removeEventListener("wheel", onWheel);
  }, [base.w, base.h]);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Node clicks call stopPropagation, so this only fires for empty-canvas mousedowns.
    if (e.target !== scrollRef.current && (e.target as HTMLElement).dataset?.id) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: scroll.scrollLeft, scrollTop: scroll.scrollTop, moved: false };
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const scroll = scrollRef.current;
    if (!drag || !scroll) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      drag.moved = true;
      scroll.classList.add("panning");
      scroll.style.overflow = "auto";
    }
    if (!drag.moved) return;

    scroll.scrollLeft = drag.scrollLeft - dx;
    scroll.scrollTop = drag.scrollTop - dy;
  };

  const onMouseUp = () => {
    dragRef.current = null;
    const scroll = scrollRef.current;
    scroll?.classList.remove("panning");
    if (scroll) scroll.style.overflow = "hidden";
  };

  return {
    scrollRef,
    scale,
    renderSize,
    didPan: () => dragRef.current?.moved === true,
    handlers: { onMouseDown, onMouseMove, onMouseUp },
  };
}
