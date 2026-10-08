/** Upright art has a minimum screen size, so cull its screen bounds, not a ground point. */
export const agentScale = (zoom: number) => Math.max(0.32, Math.min(1.2, zoom));
export function agentInViewport(x: number, y: number, zoom: number, width: number, height: number, retained = false): boolean {
  const k = agentScale(zoom), margin = retained ? 128 : 80;
  return x + 64 * k >= -margin && x - 64 * k <= width + margin &&
    y + 24 * k >= -margin && y - 110 * k <= height + margin;
}
