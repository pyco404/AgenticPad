// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";

export const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';

/**
 * A Text that stays readable in a pixel-art game. `pixelArt` filters every
 * texture NEAREST, which keeps sprites crisp and makes text jagged under zoom,
 * and every setText re-uploads the texture with NEAREST again - so the LINEAR
 * filter is put back after each update, and the text renders at a high
 * resolution so zooming in has something to show.
 */
export function crispText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  style: Phaser.Types.GameObjects.Text.TextStyle,
): Phaser.GameObjects.Text {
  const resolution = Math.max(4, Math.ceil((window.devicePixelRatio || 1) * 2.5));
  const t = scene.add.text(x, y, text, { resolution, ...style });
  const linear = () => t.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  linear();
  const update = t.updateText.bind(t);
  t.updateText = () => {
    const r = update();
    linear();
    return r;
  };
  return t;
}
